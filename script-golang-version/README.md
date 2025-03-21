# Property Embeddings Generator (Go Version)

This is a Go implementation of the property embeddings generator. It processes property data from MongoDB, generates embeddings using Google's Gemini AI, and stores the properties with their embeddings in a target collection.

## Features

- Parallel processing using Go's goroutines
- Retry mechanism with exponential backoff for API calls
- Batch processing for efficient database operations
- Detailed logging of progress

## Prerequisites

- Go 1.21 or higher
- MongoDB instance with property data
- Google Generative AI API key

## Setup

1. Clone the repository
2. Set up the environment variables:

```bash
# Copy the .env file from the parent directory or create a new one
cp ../.env ./ 
```

3. Install dependencies:

```bash
go mod download
```

## Usage

Run the application:

```bash
go run main.go
```

Or build and run the binary:

```bash
go build -o property-embeddings
./property-embeddings
```

The program will:
- Connect to the specified MongoDB database
- Create a new collection for embeddings if it doesn't exist
- Process all properties in parallel using multiple goroutines
- Generate embeddings for each property using Gemini AI
- Store the original property as metadata along with the embeddings

## Environment Variables

- `MONGODB_URI`: MongoDB connection string (default: "mongodb://localhost:27017")
- `MONGODB_DB_NAME`: Database name (default: "properties_db")
- `SOURCE_COLLECTION`: Source collection name (default: "properties")
- `TARGET_COLLECTION`: Target collection name (default: "properties_embeddings")
- `GOOGLE_GENERATIVE_AI_API_KEY`: Google Generative AI API key (required)

## Property Schema

The script expects the source collection to contain documents with a structure matching the `Property` struct in the code.

## Output Schema

The script generates documents in this format:

```go
type PropertyWithEmbedding struct {
    Metadata   Property    `bson:"metadata" json:"metadata"`
    Embeddings []float32   `bson:"embeddings" json:"embeddings"`
}
``` 
