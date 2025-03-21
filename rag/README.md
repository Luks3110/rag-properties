# Property RAG System

A Retrieval Augmented Generation (RAG) system built with LangChain.js and LangGraph for answering questions about property listings.

## Overview

This system uses:
- **LangChain.js with LangGraph**: For creating a structured agent workflow
- **MongoDB Atlas Vector Search**: For semantic search of property listings
- **Google's Generative AI**: For generating embeddings and natural language responses

## Prerequisites

1. MongoDB Atlas cluster with Vector Search enabled (or use the provided Docker setup)
2. Google AI API key (for Gemini model access)
3. Node.js 18+ (for local development)
4. pnpm package manager (for local development)
5. Docker and Docker Compose (for containerized setup)

## Setup

### Option 1: Local Development

1. Clone this repository
2. Install dependencies:
   ```
   pnpm install
   ```
3. Create a `.env` file based on `.env.example`:
   ```
   cp .env.example .env
   ```
4. Fill in your environment variables in the `.env` file:
   - `MONGODB_URI`: Your MongoDB connection string
   - `MONGODB_DATABASE`: Database name containing property data
   - `MONGODB_COLLECTION`: Collection name with embedded property documents
   - `MONGODB_VECTOR_INDEX`: Name of the vector search index
   - `GOOGLE_API_KEY`: Your Google AI API key

### Option 2: Docker Compose

1. Clone this repository
2. Create a `.env` file with your Google API key:
   ```
   GOOGLE_API_KEY=your_google_api_key_here
   ```
3. Start the containers:
   ```
   docker-compose up -d
   ```
4. Set up the vector index (first time only):
   ```
   docker exec rag-service node scripts/setup-vector-index.js
   ```

## Vector Search Index

If you're using your own MongoDB instance, ensure you have created a vector search index in MongoDB Atlas. The index should be created on the field that contains your embeddings (typically named `embedding`).

Example index configuration:
```json
{
  "fields": [
    {
      "type": "vector",
      "path": "embeddings",
      "numDimensions": 768,
      "similarity": "cosine"
    }
  ]
}
```

If you're using the Docker setup, the vector index will be created automatically when you run the setup script.

## Usage

### Interactive Conversation Mode

Start an interactive conversation with the RAG assistant:

```bash
# Local development
pnpm dev

# Docker
docker exec -it rag-service pnpm dev
```

This will start a conversation interface in your terminal where you can ask multiple questions about properties. The assistant will maintain conversation context between questions. Type "exit" or "quit" to end the conversation.

### Programmatic Usage

For integration with other applications, you can import and use the `runRagAgent` function:

```typescript
import { runRagAgent } from './lib/graph';

// For a single query
const response = await runRagAgent("Tell me about luxury apartments");

// For a conversation with history
const chatHistory = [
  { role: 'user', content: 'What properties have 3 bedrooms?' },
  { role: 'assistant', content: 'I found several properties with 3 bedrooms...' }
];
const response = await runRagAgent("Which one is the cheapest?", chatHistory);

console.log(response);
```

## Architecture

The system follows a LangGraph architecture:

1. **State Management**: Defined with LangGraph annotations
2. **MongoDB Service**: Handles connections and vector search
3. **Embedding Service**: Generates embeddings for user queries
4. **LangGraph Nodes**:
   - `embedQuery`: Generates embeddings for the query
   - `retrieveDocuments`: Retrieves relevant documents from MongoDB
   - `generateResponse`: Generates a response based on retrieved documents
   - `handleError`: Handles errors gracefully
5. **LangGraph Workflow**: Orchestrates the flow between nodes with conditional routing

## Development

Build the TypeScript code:
```
pnpm build
```

Run with TypeScript directly (development):
```
pnpm dev
```

Run the compiled JavaScript (production):
```
pnpm start
```

## Docker Commands

Start the containers:
```
docker-compose up -d
```

Stop the containers:
```
docker-compose down
```

View logs:
```
docker-compose logs -f
```

Access the RAG service shell:
```
docker exec -it rag-service sh
```

Access the MongoDB shell:
```
docker exec -it mongodb-atlas-local mongosh
``` 
