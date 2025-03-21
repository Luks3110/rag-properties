import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

interface EnvironmentVariables {
    MONGODB_URI: string;
    MONGODB_DATABASE: string;
    MONGODB_COLLECTION: string;
    MONGODB_VECTOR_INDEX: string;
    GOOGLE_API_KEY: string;
}

function validateEnv(): EnvironmentVariables {
    const requiredEnvVars: (keyof EnvironmentVariables)[] = [
        'MONGODB_URI',
        'MONGODB_DATABASE',
        'MONGODB_COLLECTION',
        'MONGODB_VECTOR_INDEX',
        'GOOGLE_API_KEY'
    ];

    const missingVars = requiredEnvVars.filter(
        (varName) => !process.env[varName]
    );

    if (missingVars.length > 0) {
        throw new Error(
            `Missing required environment variables: ${missingVars.join(', ')}`
        );
    }

    return {
        MONGODB_URI: process.env.MONGODB_URI as string,
        MONGODB_DATABASE: process.env.MONGODB_DATABASE as string,
        MONGODB_COLLECTION: process.env.MONGODB_COLLECTION as string,
        MONGODB_VECTOR_INDEX: process.env.MONGODB_VECTOR_INDEX as string,
        GOOGLE_API_KEY: process.env.GOOGLE_API_KEY as string,
    };
}

export const env = validateEnv(); 
