import { Document } from '@langchain/core/documents';

/**
 * Represents a property document from the MongoDB collection
 */
export interface PropertyDocument {
    id?: string;
    title: string;
    description: string;
    price: number;
    address: string;
    bedrooms: number;
    bathrooms: number;
    area: number;
    features: string[];
    [key: string]: any; // For any additional fields that might be present
}

/**
 * Chat message format
 */
export interface ChatMessage {
    role: 'user' | 'assistant';
    content: string;
}

/**
 * Represents the state of the RAG agent
 */
export interface RagState {
    /** The original user query */
    query: string;

    /** Embeddings generated from the user query */
    queryEmbeddings?: number[];

    /** Retrieved property documents from MongoDB */
    retrievedDocuments?: Document[];

    /** The final response to the user query */
    response?: string;

    /** Error information if any step fails */
    error?: {
        message: string;
        details?: any;
    };

    /** Chat history for multi-turn conversations */
    chatHistory: ChatMessage[];
} 
