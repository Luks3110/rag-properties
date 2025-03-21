import { GoogleGenerativeAI } from "@google/generative-ai";
import dotenv from "dotenv";
import { Document, MongoClient } from "mongodb";
import cluster from "node:cluster";
import { cpus } from "node:os";

// Load environment variables
dotenv.config();

// Get total number of CPUs for cluster size
const numCPUs = cpus().length;
// Use at most 4 workers to avoid overloading APIs
const maxWorkers = Math.min(4, numCPUs);

// MongoDB connection info
const MONGODB_URI = process.env.MONGODB_URI || "mongodb://localhost:27017";
const DB_NAME = process.env.MONGODB_DB_NAME || "properties_db";
const SOURCE_COLLECTION = process.env.SOURCE_COLLECTION || "properties";
const TARGET_COLLECTION = process.env.TARGET_COLLECTION || "properties_embeddings";

// Gemini API key
const API_KEY = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
if (!API_KEY) {
    console.error("Missing GOOGLE_GENERATIVE_AI_API_KEY environment variable");
    process.exit(1);
}

// Initialize Gemini
const genAI = new GoogleGenerativeAI(API_KEY);
const embedModel = genAI.getGenerativeModel({ model: "text-embedding-004" });

// Vector size for text-embedding-004
const VECTOR_SIZE = 768;

// Batch size for processing
const BATCH_SIZE = 50;

// Interface for property document
interface Property extends Document {
    _id: any;
    region?: string;
    city?: string;
    state?: string;
    ad?: {
        title?: string;
        description?: string;
        transactionType?: string;
    };
    company?: {
        name?: string;
        smallLogo?: string;
        largeLogo?: string | null;
    };
    companyId?: string;
    agent?: {
        id?: string;
        name?: string;
    };
    images?: any[];
    area?: number;
    rentPrice?: number;
    askingPrice?: number;
    commercialId?: string;
    totalArea?: number;
    suites?: number;
    bedrooms?: number;
    bathrooms?: number;
    parkingSpots?: number;
    isExclusive?: boolean;
    building?: string;
    condoFee?: number | null;
    tax?: number | null;
    features?: string[];
    propertyType?: string;
}

// Interface for property document with embeddings
interface PropertyWithEmbedding extends Document {
    metadata: Property;
    embeddings: number[];
}

// Message interface for worker communication
interface WorkerMessage {
    type: string;
    workerId: number;
    propertiesProcessed?: number;
    error?: string;
}

// Add retry logic with exponential backoff
async function generateEmbeddingWithRetry(text: string, maxRetries = 5): Promise<number[] | null> {
    let retries = 0;
    const initialBackoff = 1000; // Start with 1 second delay

    while (retries < maxRetries) {
        try {
            const result = await embedModel.embedContent(text);
            return result.embedding.values;
        } catch (error) {
            retries++;
            if (retries >= maxRetries) {
                console.error(`Failed to generate embedding after ${maxRetries} attempts:`, error);
                return null;
            }

            // Calculate exponential backoff with jitter
            const delay = initialBackoff * Math.pow(2, retries - 1) * (0.5 + Math.random());
            console.log(`Embedding API error. Retrying in ${Math.round(delay / 1000)} seconds... (Attempt ${retries}/${maxRetries})`);
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }

    return null;
}

// Function to create a rich text description from property data
function createPropertyDescription(property: Property): string {
    const features = property.features?.join(", ") || "";

    const description = [
        `Title: ${property.ad?.title || ""}`,
        `Description: ${property.ad?.description || ""}`,
        `Location: ${property.region || ""}, ${property.city || ""}, ${property.state || ""}`,
        `Property Type: ${property.propertyType || ""}`,
        `Transaction Type: ${property.ad?.transactionType || ""}`,
        `Area: ${property.area || 0} m²`,
        `Total Area: ${property.totalArea || 0} m²`,
        `Price: ${property.ad?.transactionType?.includes("rent") ?
            `Rent $${property.rentPrice || 0}` :
            `Sale $${property.askingPrice || 0}`}`,
        `Bedrooms: ${property.bedrooms || 0}`,
        `Suites: ${property.suites || 0}`,
        `Bathrooms: ${property.bathrooms || 0}`,
        `Parking Spots: ${property.parkingSpots || 0}`,
        `Building: ${property.building || ""}`,
        `Exclusive: ${property.isExclusive ? "Yes" : "No"}`,
        `Features: ${features}`,
    ]
        .filter(line => line.trim() !== "" && !line.endsWith(": "))
        .join("\n");

    return description;
}

// Count total properties
async function countTotalProperties(client: MongoClient): Promise<number> {
    try {
        const db = client.db(DB_NAME);
        const collection = db.collection(SOURCE_COLLECTION);
        const count = await collection.countDocuments();
        console.log(`Total properties to process: ${count}`);
        return count;
    } catch (error) {
        console.error("Error counting properties:", error);
        throw error;
    }
}

// Process worker function
async function processProperties(
    workerId: number,
    totalWorkers: number,
    client: MongoClient
): Promise<number> {
    console.log(`[Worker ${workerId}] Starting to process properties`);

    let propertiesProcessed = 0;

    try {
        const db = client.db(DB_NAME);
        const sourceCollection = db.collection<Property>(SOURCE_COLLECTION);
        const targetCollection = db.collection<PropertyWithEmbedding>(TARGET_COLLECTION);

        // Create text index on metadata._id for efficient lookups
        await targetCollection.createIndex({ "metadata._id": 1 });

        // Get cursor for all documents
        const cursor = sourceCollection.find();

        let currentIndex = 0;
        let batchDocuments: PropertyWithEmbedding[] = [];

        // Process each property
        for await (const property of cursor) {
            currentIndex++;

            // Log progress periodically
            if (currentIndex % 100 === 0 || currentIndex === 1) {
                console.log(`[Worker ${workerId}] Scanning property ${currentIndex}`);
            }

            // Skip properties that don't belong to this worker
            if ((currentIndex - 1) % totalWorkers !== (workerId - 1)) {
                continue;
            }

            propertiesProcessed++;
            if (propertiesProcessed % 10 === 0) {
                console.log(`[Worker ${workerId}] Processed ${propertiesProcessed} properties so far`);
            }

            // Check if this property already has embeddings
            const existing = await targetCollection.findOne({ "metadata._id": property._id });
            if (existing) {
                console.log(`[Worker ${workerId}] Property ${property._id} already has embeddings, skipping`);
                continue;
            }

            // Create rich description for embedding
            const description = createPropertyDescription(property);

            // Generate embedding
            const embedding = await generateEmbeddingWithRetry(description);

            if (embedding) {
                // Create document with metadata and embeddings
                const documentWithEmbedding: PropertyWithEmbedding = {
                    metadata: property,
                    embeddings: embedding
                };

                batchDocuments.push(documentWithEmbedding);

                // Insert in batches
                if (batchDocuments.length >= BATCH_SIZE) {
                    try {
                        await targetCollection.insertMany(batchDocuments);
                        console.log(`[Worker ${workerId}] Inserted batch of ${batchDocuments.length} properties (processed: ${propertiesProcessed})`);
                        batchDocuments = [];
                    } catch (error) {
                        console.error(`[Worker ${workerId}] Error inserting batch:`, error);
                    }
                }
            } else {
                console.warn(`[Worker ${workerId}] Failed to generate embedding for property ${property._id}`);
            }
        }

        // Insert any remaining documents
        if (batchDocuments.length > 0) {
            try {
                await targetCollection.insertMany(batchDocuments);
                console.log(`[Worker ${workerId}] Inserted final batch of ${batchDocuments.length} properties (total: ${propertiesProcessed})`);
            } catch (error) {
                console.error(`[Worker ${workerId}] Error inserting final batch:`, error);
            }
        }

        console.log(`[Worker ${workerId}] Completed processing ${propertiesProcessed} properties`);
        return propertiesProcessed;
    } catch (error) {
        console.error(`[Worker ${workerId}] Error processing properties:`, error);
        throw error;
    }
}

// Worker process function
async function workerProcess(): Promise<void> {
    try {
        // Get worker ID from environment variable
        const workerId = parseInt(process.env.WORKER_ID || "1");
        console.log(`Worker ${workerId} started (PID: ${process.pid})`);

        // Each worker processes its portion of data
        const totalWorkers = parseInt(process.env.TOTAL_WORKERS || "4");

        // Connect to MongoDB
        const client = new MongoClient(MONGODB_URI);
        await client.connect();
        console.log(`[Worker ${workerId}] Connected to MongoDB`);

        // Process properties
        const propertiesProcessed = await processProperties(workerId, totalWorkers, client);

        // Close MongoDB connection
        await client.close();

        // Report completion back to primary
        if (process.send) {
            process.send({
                type: 'complete',
                workerId,
                propertiesProcessed
            });
            console.log(`[Worker ${workerId}] Sent completion message to primary`);
        } else {
            console.log(`[Worker ${workerId}] Completed processing ${propertiesProcessed} properties (process.send not available)`);
        }
    } catch (error) {
        console.error(`Worker error:`, error);
        if (process.send) {
            process.send({
                type: 'error',
                workerId: parseInt(process.env.WORKER_ID || "0"),
                error: error instanceof Error ? error.message : String(error)
            });
        }
        process.exit(1);
    }
}

// Primary process function
async function primaryProcess(): Promise<void> {
    try {
        console.log(`Primary process ${process.pid} is running`);
        console.log(`Setting up ${maxWorkers} workers...`);

        // Connect to MongoDB
        const client = new MongoClient(MONGODB_URI);
        await client.connect();
        console.log("Connected to MongoDB");

        // Count total properties
        const totalProperties = await countTotalProperties(client);

        console.log("🚀 ~ Total Proeprties: ", totalProperties)

        // Set up target collection
        const db = client.db(DB_NAME);
        const targetCollection = db.collection(TARGET_COLLECTION);

        console.log("🚀 ~ Target Collection: ", targetCollection)

        // Track worker completion
        let completedWorkers = 0;
        let totalProcessed = 0;

        // Handle messages from workers
        cluster.on('message', (worker, message: WorkerMessage) => {
            if (message.type === 'complete') {
                console.log(`Worker ${message.workerId} completed processing ${message.propertiesProcessed} properties`);
                totalProcessed += message.propertiesProcessed || 0;
                completedWorkers++;

                if (completedWorkers === maxWorkers) {
                    console.log(`All workers completed. Total properties processed: ${totalProcessed}`);
                    console.log("Import completed successfully");

                    // Close MongoDB connection
                    client.close().then(() => {
                        // Exit after cleanup
                        setTimeout(() => process.exit(0), 1000);
                    });
                }
            } else if (message.type === 'error') {
                console.error(`Worker ${message.workerId} encountered an error: ${message.error}`);
            }
        });

        // Handle worker exits
        cluster.on('exit', (worker, code, signal) => {
            if (code !== 0) {
                console.error(`Worker ${worker.id} died with code ${code} and signal ${signal}`);
            }
        });

        // Fork workers with environment variables for direct configuration
        for (let i = 1; i <= maxWorkers; i++) {
            const worker = cluster.fork({
                WORKER_ID: i.toString(),
                TOTAL_WORKERS: maxWorkers.toString()
            });

            console.log(`Started worker ${i} with PID ${worker.process.pid}`);
        }
    } catch (error) {
        console.error("Error in primary process:", error);
        await (new MongoClient(MONGODB_URI)).close();
        process.exit(1);
    }
}

// Main execution
if (cluster.isPrimary) {
    primaryProcess();
} else {
    workerProcess();
} 
