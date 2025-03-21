import { Collection, MongoClient } from 'mongodb';
import { env } from '../config/env';

let client: MongoClient | null = null;

/**
 * Connect to MongoDB Atlas
 */
async function connectToMongoDB(): Promise<MongoClient> {
    if (client) return client;

    client = new MongoClient(env.MONGODB_URI);

    try {
        await client.connect();
        console.log('✅ Connected to MongoDB Atlas');
        return client;
    } catch (error) {
        console.error('❌ Error connecting to MongoDB:', error);
        throw error;
    }
}

/**
 * Initialize MongoDB connection
 * Call this function at application startup
 */
export async function initializeMongoDB(): Promise<void> {
    await connectToMongoDB();
}

/**
 * Get the collection for property data
 */
export async function getPropertyCollection(): Promise<Collection> {
    if (!client) {
        throw new Error('MongoDB not initialized. Call initializeMongoDB() first.');
    }

    const db = client.db(env.MONGODB_DATABASE);
    return db.collection(env.MONGODB_COLLECTION);
}

/**
 * Perform vector search using MongoDB Atlas Vector Search
 * @param embeddings - The embeddings to search with
 * @param limit - Maximum number of results to return
 */
export async function vectorSearch(embeddings: number[], limit = 5) {
    const collection = await getPropertyCollection();

    const pipeline = [
        {
            $vectorSearch: {
                index: "default",
                path: 'embeddings',
                queryVector: embeddings,
                numCandidates: limit * 10,
                limit: limit
            }
        },
        {
            $project: {
                _id: 0,
                embeddings: 0
            }
        }
    ];

    const results = await collection.aggregate(pipeline).toArray();
    return results;
}

/**
 * Close the MongoDB connection
 */
export async function closeMongoDBConnection(): Promise<void> {
    if (client) {
        await client.close();
        client = null;
        console.log('MongoDB connection closed');
    }
} 
