import { GenerativeModel, GoogleGenerativeAI } from '@google/generative-ai';
import { env } from '../config/env';

let embeddingModel: GenerativeModel | null = null;

/**
 * Initialize the embedding model
 */
function getEmbeddingModel(): GenerativeModel {
    if (!embeddingModel) {
        const genAI = new GoogleGenerativeAI(env.GOOGLE_API_KEY);
        embeddingModel = genAI.getGenerativeModel({ model: 'text-embedding-004' });
    }
    return embeddingModel;
}

/**
 * Generate embeddings for a text
 * @param text - Text to generate embeddings for
 * @returns Array of embedding values
 */
export async function generateEmbedding(text: string): Promise<number[]> {
    try {
        const model = getEmbeddingModel();
        const embeddingResult = await model.embedContent(text);
        const embedding = embeddingResult.embedding.values;
        return embedding;
    } catch (error) {
        console.error('Error generating embedding:', error);
        throw error;
    }
} 
