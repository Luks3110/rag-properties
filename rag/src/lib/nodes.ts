import { GoogleGenerativeAI, HarmBlockThreshold, HarmCategory } from '@google/generative-ai';
import { Document } from '@langchain/core/documents';
import { character } from '../characters/ana';
import { env } from '../config/env';
import { generateEmbedding } from '../services/embedding.service';
import { vectorSearch } from '../services/mongodb.service';
import { RagState } from '../types/state';

/**
 * Create a system prompt for the Gemini model
 */
function createSystemPrompt(documents: Document[]): string {
    return `${character.system}

Você é uma consultora de vendas imobiliários especializada em fornecer informações sobre propriedades e imóveis.
Você sempre mantém seu tom ${character.adjectives.join(', ')}.

ESTILO DE COMUNICAÇÃO:
${character.style.all.join('\n')}
${character.style.chat.join('\n')}

PERFIL PESSOAL:
${character.bio.join('\n')}

TÓPICOS DE ESPECIALIDADE:
- Propriedades imobiliárias
- Casas e apartamentos à venda
- Informações sobre bairros e regiões
- Preços e condições de imóveis
${character.topics.map((topic: string) => `- ${topic}`).join('\n')}

Você será fornecida com informações sobre propriedades e uma consulta do usuário. Use as informações de propriedade para responder à consulta do usuário com precisão.
Se as informações fornecidas não responderem à consulta do usuário, educadamente informe que você não tem essa informação específica.

Aqui estão os detalhes da propriedade que você pode consultar:
${JSON.stringify(documents.map(doc => doc.pageContent), null, 2)}
`;
}

/**
 * Generate embeddings for the user query
 */
export async function generateQueryEmbeddings(state: RagState): Promise<RagState> {
    try {
        console.log('🔍 Generating embeddings for query:', state.query);
        const embeddings = await generateEmbedding(state.query);

        return {
            ...state,
            queryEmbeddings: embeddings
        };
    } catch (error) {
        console.error('Error generating query embeddings:', error);
        return {
            ...state,
            error: {
                message: 'Failed to generate embeddings for the query',
                details: error
            }
        };
    }
}

export async function composeSearch(state: RagState): Promise<RagState> {
    try {
        console.log('🔍 Composing search:', state.query);

        const genAI = new GoogleGenerativeAI(env.GOOGLE_API_KEY);
        const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

        const promptWithSchema = `
        Você é um especialista em imóveis. Melhore a seguinte consulta do usuário para uma pesquisa eficaz de imóveis.
        
        Consulta original: "${state.query}"
        
        Transforme essa consulta em uma descrição mais detalhada e específica para buscar imóveis.
        Extraia informações como:
        - Tipo de imóvel (apartamento, casa, comercial)
        - Tipo de transação (aluguel, venda)
        - Localização (região, cidade, bairro)
        - Características (área, quartos, suítes, banheiros, vagas)
        - Faixa de preço
        - Recursos desejados
        
        Expanda abreviações (ex: "apto" para "apartamento") e adicione termos relacionados.
        Se a consulta original não especificar algum parâmetro, não invente.
        
        Retorne apenas o texto melhorado da consulta, sem explicações adicionais.
        `;

        const result = await model.generateContent(promptWithSchema);
        const improvedQuery = result.response.text().trim();

        console.log('🔄 Improved query:', improvedQuery);

        const embeddings = await generateEmbedding(improvedQuery);

        return {
            ...state,
            query: improvedQuery,
            queryEmbeddings: embeddings
        };
    } catch (error) {
        console.error('Error composing search query:', error);
        return {
            ...state,
            error: {
                message: 'Failed to compose improved search query',
                details: error
            }
        };
    }
}

/**
 * Retrieve relevant documents from MongoDB using vector search
 */
export async function retrieveDocuments(state: RagState): Promise<RagState> {
    if (!state.queryEmbeddings || !state.query) {
        return {
            ...state,
            error: {
                message: 'No query embeddings available for search'
            }
        };
    }

    try {
        console.log('📚 Retrieving relevant documents from MongoDB');

        const properties = await vectorSearch(state.queryEmbeddings, 5);

        const documents = properties.map((property: any) => {
            return new Document({
                pageContent: JSON.stringify(property),
                metadata: property.metadata
            });
        });

        return {
            ...state,
            retrievedDocuments: documents
        };
    } catch (error) {
        console.error('Error retrieving documents:', error);

        const errorMessage = error instanceof Error && error.message.includes('MongoDB not initialized')
            ? 'Database connection is not established. Please restart the application.'
            : 'Failed to retrieve relevant documents';

        return {
            ...state,
            error: {
                message: errorMessage,
                details: error
            }
        };
    }
}

/**
 * Generate a response using the Gemini model based on retrieved documents
 */
export async function generateResponse(state: RagState): Promise<RagState> {
    if (!state.retrievedDocuments || state.retrievedDocuments.length === 0) {
        return {
            ...state,
            response: "Olá! Infelizmente não consegui encontrar informações relevantes sobre imóveis para responder sua pergunta. Posso ajudar com algo mais específico sobre propriedades disponíveis?"
        };
    }

    try {
        console.log('✨ Generating response based on retrieved documents');
        const genAI = new GoogleGenerativeAI(env.GOOGLE_API_KEY);
        const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

        const systemPrompt = createSystemPrompt(state.retrievedDocuments);

        const chat = model.startChat({
            history: [
                {
                    role: 'user',
                    parts: [{ text: 'Olá, gostaria de saber sobre imóveis.' }],
                },
                {
                    role: 'model',
                    parts: [{ text: "Olá! Que prazer em ajudar você! Sou Ana, consultora especializada em imóveis. Como posso auxiliar na sua busca pelo imóvel ideal hoje?" }],
                },
                ...state.chatHistory.map(message => ({
                    role: message.role === 'user' ? 'user' : 'model',
                    parts: [{ text: message.content }],
                })),
            ],
            generationConfig: {
                temperature: 0.7,
                topK: 32,
                topP: 0.95,
                maxOutputTokens: 2048,
            },
            safetySettings: [
                {
                    category: HarmCategory.HARM_CATEGORY_HARASSMENT,
                    threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE
                },
                {
                    category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
                    threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE
                },
                {
                    category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
                    threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE
                },
                {
                    category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
                    threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE
                }
            ]
        });

        const result = await chat.sendMessage([
            { text: systemPrompt },
            { text: state.query }
        ]);
        const response = result.response.text();

        return {
            ...state,
            response,
            chatHistory: [
                ...state.chatHistory,
                { role: 'user', content: state.query },
                { role: 'assistant', content: response }
            ]
        };
    } catch (error) {
        console.error('Error generating response:', error);
        return {
            ...state,
            error: {
                message: 'Failed to generate a response',
                details: error
            },
            response: "Desculpe, encontrei um problema ao processar sua pergunta. Poderia tentar novamente mais tarde? Estou aqui para ajudar quando estiver tudo funcionando corretamente."
        };
    }
}

/**
 * Handle errors in the RAG pipeline
 */
export function handleError(state: RagState): RagState {
    console.error('❌ Error in RAG pipeline:', state.error);

    const errorMessage = `Ops! Encontrei um erro ao processar sua solicitação sobre imóveis: ${state.error?.message}. Poderia tentar novamente mais tarde? Estou ansiosa para ajudá-lo a encontrar o imóvel ideal assim que tudo estiver funcionando corretamente.`;

    return {
        ...state,
        response: errorMessage,
        chatHistory: [
            ...state.chatHistory,
            { role: 'user', content: state.query },
            { role: 'assistant', content: errorMessage }
        ]
    };
} 
