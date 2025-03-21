package main

import (
	"context"
	"fmt"
	"log"
	"math"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/google/generative-ai-go/genai"
	"github.com/joho/godotenv"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
	"google.golang.org/api/option"
)

// Batch size for processing
const batchSize = 50

// MongoDB collection names and database
var (
	mongoURI         string
	dbName           string
	sourceCollection string
	targetCollection string
	apiKey           string
)

// Property represents a property document from MongoDB
type Property struct {
	ID            primitive.ObjectID `bson:"_id,omitempty" json:"_id,omitempty"`
	Region        string             `bson:"region,omitempty" json:"region,omitempty"`
	City          string             `bson:"city,omitempty" json:"city,omitempty"`
	State         string             `bson:"state,omitempty" json:"state,omitempty"`
	Ad            *Ad                `bson:"ad,omitempty" json:"ad,omitempty"`
	Company       *Company           `bson:"company,omitempty" json:"company,omitempty"`
	CompanyID     string             `bson:"companyId,omitempty" json:"companyId,omitempty"`
	Agent         *Agent             `bson:"agent,omitempty" json:"agent,omitempty"`
	Images        []interface{}      `bson:"images,omitempty" json:"images,omitempty"`
	Area          float64            `bson:"area,omitempty" json:"area,omitempty"`
	RentPrice     float64            `bson:"rentPrice,omitempty" json:"rentPrice,omitempty"`
	AskingPrice   float64            `bson:"askingPrice,omitempty" json:"askingPrice,omitempty"`
	CommercialID  string             `bson:"commercialId,omitempty" json:"commercialId,omitempty"`
	TotalArea     float64            `bson:"totalArea,omitempty" json:"totalArea,omitempty"`
	Suites        int                `bson:"suites,omitempty" json:"suites,omitempty"`
	Bedrooms      int                `bson:"bedrooms,omitempty" json:"bedrooms,omitempty"`
	Bathrooms     int                `bson:"bathrooms,omitempty" json:"bathrooms,omitempty"`
	ParkingSpots  int                `bson:"parkingSpots,omitempty" json:"parkingSpots,omitempty"`
	IsExclusive   bool               `bson:"isExclusive,omitempty" json:"isExclusive,omitempty"`
	Building      string             `bson:"building,omitempty" json:"building,omitempty"`
	CondoFee      *float64           `bson:"condoFee,omitempty" json:"condoFee,omitempty"`
	Tax           *float64           `bson:"tax,omitempty" json:"tax,omitempty"`
	Features      []string           `bson:"features,omitempty" json:"features,omitempty"`
	PropertyType  string             `bson:"propertyType,omitempty" json:"propertyType,omitempty"`
}

// Ad represents the advertisement details of a property
type Ad struct {
	Title           string `bson:"title,omitempty" json:"title,omitempty"`
	Description     string `bson:"description,omitempty" json:"description,omitempty"`
	TransactionType string `bson:"transactionType,omitempty" json:"transactionType,omitempty"`
}

// Company represents the company details of a property
type Company struct {
	Name      string  `bson:"name,omitempty" json:"name,omitempty"`
	SmallLogo string  `bson:"smallLogo,omitempty" json:"smallLogo,omitempty"`
	LargeLogo *string `bson:"largeLogo,omitempty" json:"largeLogo,omitempty"`
}

// Agent represents the agent details of a property
type Agent struct {
	ID   string `bson:"id,omitempty" json:"id,omitempty"`
	Name string `bson:"name,omitempty" json:"name,omitempty"`
}

// PropertyWithEmbedding represents a property with its embedding
type PropertyWithEmbedding struct {
	Metadata   Property   `bson:"metadata" json:"metadata"`
	Embeddings []float32  `bson:"embeddings" json:"embeddings"`
}

// WorkerResult represents the result of a worker's processing
type WorkerResult struct {
	WorkerID            int
	PropertiesProcessed int
	Error               error
}

// Initialize environment variables from .env file
func init() {
	// Load .env file from parent directory
	envPath := filepath.Join("..", ".env")
	err := godotenv.Load(envPath)
	if err != nil {
		// Try the current directory if not found in parent
		err = godotenv.Load()
		if err != nil {
			log.Println("Warning: .env file not found, using environment variables")
		}
	}

	// Set configuration from environment variables
	mongoURI = getEnv("MONGODB_URI", "mongodb://localhost:27017")
	dbName = getEnv("MONGODB_DB_NAME", "properties_db")
	sourceCollection = getEnv("SOURCE_COLLECTION", "properties")
	targetCollection = getEnv("TARGET_COLLECTION", "properties_embeddings")
	apiKey = getEnv("GOOGLE_GENERATIVE_AI_API_KEY", "")

	if apiKey == "" {
		log.Fatal("GOOGLE_GENERATIVE_AI_API_KEY is not set")
	}
}

// Helper function to get environment variable with a default value
func getEnv(key, defaultValue string) string {
	value := os.Getenv(key)
	if value == "" {
		return defaultValue
	}
	return value
}

// Create rich text description from property data
func createPropertyDescription(property *Property) string {
	var features string
	if property.Features != nil {
		features = strings.Join(property.Features, ", ")
	}

	var lines []string

	// Add non-empty fields to description
	if property.Ad != nil && property.Ad.Title != "" {
		lines = append(lines, fmt.Sprintf("Title: %s", property.Ad.Title))
	}
	if property.Ad != nil && property.Ad.Description != "" {
		lines = append(lines, fmt.Sprintf("Description: %s", property.Ad.Description))
	}

	location := strings.TrimSpace(fmt.Sprintf("%s, %s, %s", 
		property.Region, property.City, property.State))
	if location != ",," {
		lines = append(lines, fmt.Sprintf("Location: %s", location))
	}

	if property.PropertyType != "" {
		lines = append(lines, fmt.Sprintf("Property Type: %s", property.PropertyType))
	}
	if property.Ad != nil && property.Ad.TransactionType != "" {
		lines = append(lines, fmt.Sprintf("Transaction Type: %s", property.Ad.TransactionType))
	}
	if property.Area > 0 {
		lines = append(lines, fmt.Sprintf("Area: %.2f m²", property.Area))
	}
	if property.TotalArea > 0 {
		lines = append(lines, fmt.Sprintf("Total Area: %.2f m²", property.TotalArea))
	}

	// Add price information based on transaction type
	var isRent bool
	if property.Ad != nil && property.Ad.TransactionType != "" {
		isRent = strings.Contains(strings.ToLower(property.Ad.TransactionType), "rent")
	}
	if isRent && property.RentPrice > 0 {
		lines = append(lines, fmt.Sprintf("Price: Rent $%.2f", property.RentPrice))
	} else if property.AskingPrice > 0 {
		lines = append(lines, fmt.Sprintf("Price: Sale $%.2f", property.AskingPrice))
	}

	if property.Bedrooms > 0 {
		lines = append(lines, fmt.Sprintf("Bedrooms: %d", property.Bedrooms))
	}
	if property.Suites > 0 {
		lines = append(lines, fmt.Sprintf("Suites: %d", property.Suites))
	}
	if property.Bathrooms > 0 {
		lines = append(lines, fmt.Sprintf("Bathrooms: %d", property.Bathrooms))
	}
	if property.ParkingSpots > 0 {
		lines = append(lines, fmt.Sprintf("Parking Spots: %d", property.ParkingSpots))
	}
	if property.Building != "" {
		lines = append(lines, fmt.Sprintf("Building: %s", property.Building))
	}

	lines = append(lines, fmt.Sprintf("Exclusive: %s", boolToYesNo(property.IsExclusive)))

	if features != "" {
		lines = append(lines, fmt.Sprintf("Features: %s", features))
	}

	return strings.Join(lines, "\n")
}

// Convert boolean to "Yes" or "No"
func boolToYesNo(value bool) string {
	if value {
		return "Yes"
	}
	return "No"
}

// Generate embedding for a text with retry
func generateEmbedding(ctx context.Context, text string, client *genai.Client) ([]float32, error) {
	return generateEmbeddingWithRetry(ctx, text, client, 5)
}

// Generate embedding with retry and exponential backoff
func generateEmbeddingWithRetry(
	ctx context.Context, 
	text string, 
	client *genai.Client, 
	maxRetries int,
) ([]float32, error) {
	initialBackoff := 1000 * time.Millisecond
	
	// Get the embedding model
	model := client.EmbeddingModel("text-embedding-004")
	
	for retries := 0; retries < maxRetries; retries++ {
		// Generate embedding
		resp, err := model.EmbedContent(ctx, genai.Text(text))
		if err != nil {
			if retries == maxRetries-1 {
				return nil, fmt.Errorf("failed to generate embedding after %d attempts: %w", maxRetries, err)
			}
			
			// Calculate exponential backoff with jitter
			backoff := time.Duration(float64(initialBackoff) * 
				math.Pow(2, float64(retries)) * // 2^retries
				(0.5 + 0.5*float64(time.Now().Nanosecond())/1e9)) // Add jitter
			
			log.Printf("Embedding API error. Retrying in %.2f seconds... (Attempt %d/%d)",
				float64(backoff)/float64(time.Second), retries+1, maxRetries)
			
			// Sleep before retrying
			time.Sleep(backoff)
			continue
		}
		
		// Convert to float32 array
		embedding := make([]float32, len(resp.Embedding.Values))
		for i, val := range resp.Embedding.Values {
			embedding[i] = float32(val)
		}
		
		return embedding, nil
	}
	
	return nil, fmt.Errorf("max retries exceeded")
}

// Count total properties in the source collection
func countTotalProperties(ctx context.Context, client *mongo.Client) (int64, error) {
	collection := client.Database(dbName).Collection(sourceCollection)
	count, err := collection.CountDocuments(ctx, bson.M{})
	if err != nil {
		return 0, fmt.Errorf("error counting properties: %w", err)
	}
	
	log.Printf("Total properties to process: %d", count)
	return count, nil
}

// Process properties for a worker
func processProperties(
	ctx context.Context,
	workerID int,
	totalWorkers int,
	client *mongo.Client,
	aiClient *genai.Client,
) (int, error) {
	log.Printf("[Worker %d] Starting to process properties", workerID)
	
	propertiesProcessed := 0
	
	// Get source and target collections
	sourceDB := client.Database(dbName).Collection(sourceCollection)
	targetDB := client.Database(dbName).Collection(targetCollection)
	
	// Create index on metadata._id for efficient lookups
	_, err := targetDB.Indexes().CreateOne(ctx, mongo.IndexModel{
		Keys: bson.D{{Key: "metadata._id", Value: 1}},
	})
	if err != nil {
		return 0, fmt.Errorf("error creating index: %w", err)
	}
	
	// Find all properties in source collection
	cursor, err := sourceDB.Find(ctx, bson.M{})
	if err != nil {
		return 0, fmt.Errorf("error finding properties: %w", err)
	}
	defer cursor.Close(ctx)
	
	currentIndex := 0
	var batchDocuments []interface{}
	
	// Process each property
	for cursor.Next(ctx) {
		currentIndex++
		
		// Log progress periodically
		if currentIndex%100 == 0 || currentIndex == 1 {
			log.Printf("[Worker %d] Scanning property %d", workerID, currentIndex)
		}
		
		// Skip properties that don't belong to this worker
		if (currentIndex-1)%totalWorkers != (workerID - 1) {
			continue
		}
		
		propertiesProcessed++
		if propertiesProcessed%10 == 0 {
			log.Printf("[Worker %d] Processed %d properties so far", workerID, propertiesProcessed)
		}
		
		// Decode property
		var property Property
		if err := cursor.Decode(&property); err != nil {
			log.Printf("[Worker %d] Error decoding property: %v", workerID, err)
			continue
		}
		
		// Check if this property already has embeddings
		var existing bson.M
		err := targetDB.FindOne(ctx, bson.M{"metadata._id": property.ID}).Decode(&existing)
		if err == nil {
			log.Printf("[Worker %d] Property %s already has embeddings, skipping", workerID, property.ID.Hex())
			continue
		} else if err != mongo.ErrNoDocuments {
			log.Printf("[Worker %d] Error checking for existing property: %v", workerID, err)
		}
		
		// Create rich description for embedding
		description := createPropertyDescription(&property)
		
		// Generate embedding
		embedding, err := generateEmbedding(ctx, description, aiClient)
		if err != nil {
			log.Printf("[Worker %d] Error generating embedding: %v", workerID, err)
			continue
		}
		
		if embedding != nil {
			// Create document with metadata and embeddings
			documentWithEmbedding := PropertyWithEmbedding{
				Metadata:   property,
				Embeddings: embedding,
			}
			
			batchDocuments = append(batchDocuments, documentWithEmbedding)
			
			// Insert in batches
			if len(batchDocuments) >= batchSize {
				_, err := targetDB.InsertMany(ctx, batchDocuments)
				if err != nil {
					log.Printf("[Worker %d] Error inserting batch: %v", workerID, err)
				} else {
					log.Printf("[Worker %d] Inserted batch of %d properties (processed: %d)",
						workerID, len(batchDocuments), propertiesProcessed)
				}
				batchDocuments = nil
			}
		} else {
			log.Printf("[Worker %d] Failed to generate embedding for property %s", workerID, property.ID.Hex())
		}
	}
	
	// Insert any remaining documents
	if len(batchDocuments) > 0 {
		_, err := targetDB.InsertMany(ctx, batchDocuments)
		if err != nil {
			log.Printf("[Worker %d] Error inserting final batch: %v", workerID, err)
		} else {
			log.Printf("[Worker %d] Inserted final batch of %d properties (total: %d)",
				workerID, len(batchDocuments), propertiesProcessed)
		}
	}
	
	// Check for cursor errors
	if err := cursor.Err(); err != nil {
		return propertiesProcessed, fmt.Errorf("cursor error: %w", err)
	}
	
	log.Printf("[Worker %d] Completed processing %d properties", workerID, propertiesProcessed)
	return propertiesProcessed, nil
}

func main() {
	// Use all available CPUs for workers
	// Using a constant value for now
	workers := 4
	
	log.Printf("Starting property embeddings generator with %d workers", workers)
	
	// Create context
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	
	// Connect to MongoDB
	client, err := mongo.Connect(ctx, options.Client().ApplyURI(mongoURI))
	if err != nil {
		log.Fatalf("Error connecting to MongoDB: %v", err)
	}
	defer client.Disconnect(ctx)
	
	// Ping the database to verify connection
	if err = client.Ping(ctx, nil); err != nil {
		log.Fatalf("Error pinging MongoDB: %v", err)
	}
	log.Println("Connected to MongoDB")
	
	// Count total properties
	totalProperties, err := countTotalProperties(ctx, client)
	if err != nil {
		log.Fatalf("Error counting properties: %v", err)
	}
	log.Printf("Will process a total of %d properties", totalProperties)
	
	// Initialize Gemini client for embeddings
	aiClient, err := genai.NewClient(ctx, option.WithAPIKey(apiKey))
	if err != nil {
		log.Fatalf("Error creating Gemini client: %v", err)
	}
	defer aiClient.Close()
	
	// Create a wait group to wait for all workers
	var wg sync.WaitGroup
	
	// Create a channel for results
	results := make(chan WorkerResult, workers)
	
	// Start workers
	for i := 1; i <= workers; i++ {
		wg.Add(1)
		go func(workerID int) {
			defer wg.Done()
			
			log.Printf("Starting worker %d", workerID)
			
			// Process properties
			propertiesProcessed, err := processProperties(ctx, workerID, workers, client, aiClient)
			
			// Send result
			results <- WorkerResult{
				WorkerID:            workerID,
				PropertiesProcessed: propertiesProcessed,
				Error:               err,
			}
		}(i)
	}
	
	// Close results channel when all workers are done
	go func() {
		wg.Wait()
		close(results)
	}()
	
	// Collect results
	completedWorkers := 0
	totalProcessed := 0
	
	for result := range results {
		completedWorkers++
		
		if result.Error != nil {
			log.Printf("Worker %d encountered an error: %v", result.WorkerID, result.Error)
		} else {
			log.Printf("Worker %d completed processing %d properties", result.WorkerID, result.PropertiesProcessed)
			totalProcessed += result.PropertiesProcessed
		}
		
		if completedWorkers == workers {
			log.Printf("All workers completed. Total properties processed: %d", totalProcessed)
			log.Println("Import completed successfully")
		}
	}
} 
