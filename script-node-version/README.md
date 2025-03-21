# Property Embeddings Generator

This project processes property data from MongoDB, generates embeddings using Google's Gemini AI, and stores the properties with their embeddings in a target collection.

## Features

- Multi-process architecture using Node.js cluster for parallel processing
- Retry mechanism with exponential backoff for API calls
- Batch processing for efficient database operations
- Detailed logging of progress
- TypeScript for type safety

## Prerequisites

- Node.js 18+
- pnpm
- MongoDB instance with property data
- Google Generative AI API key

## Setup

1. Clone the repository
2. Install dependencies:

```bash
pnpm install
```

3. Configure environment variables in a `.env` file:

```
GOOGLE_GENERATIVE_AI_API_KEY=your_api_key_here
MONGODB_URI=mongodb://localhost:27017
MONGODB_DB_NAME=properties_db
SOURCE_COLLECTION=properties
TARGET_COLLECTION=properties_embeddings
```

## Usage

1. Build the TypeScript code:

```bash
pnpm build
```

2. Run the application:

```bash
pnpm start
```

The script will:
- Connect to the specified MongoDB database
- Create a new collection for embeddings if it doesn't exist
- Process all properties in parallel using multiple workers
- Generate embeddings for each property using Gemini AI
- Store the original property as metadata along with the embeddings

## Development

For development with hot reloading:

```bash
pnpm dev
```

## Property Schema

The script expects the source collection to contain documents with this structure:

```typescript
interface Property {
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
  // ... other fields
}
```

## Output Schema

The script generates documents in this format:

```typescript
interface PropertyWithEmbedding {
  metadata: Property; // Original property document
  embeddings: number[]; // Embedding vector from Gemini AI
}
``` 
