import { createInterface } from 'readline';
import { runRagAgent } from './lib/graph';
import { closeMongoDBConnection, initializeMongoDB } from './services/mongodb.service';

const readline = createInterface({
    input: process.stdin,
    output: process.stdout
});

const chatHistory: { role: 'user' | 'assistant'; content: string }[] = [];

/**
 * Ask a question and return the answer as a Promise
 */
function askQuestion(query: string): Promise<string> {
    return new Promise((resolve) => {
        readline.question(query, (answer) => {
            resolve(answer);
        });
    });
}

/**
 * Main function to run the interactive RAG agent
 */
async function main() {
    try {
        console.log('🔄 Initializing MongoDB connection...');
        await initializeMongoDB();

        console.log('🏠 Property RAG Assistant');
        console.log('Ask questions about properties or type "exit" to quit\n');

        while (true) {
            const query = await askQuestion('👤 You: ');

            if (query.toLowerCase() === 'exit' || query.toLowerCase() === 'quit') {
                console.log('\nThank you for using the Property RAG Assistant. Goodbye! 👋');
                break;
            }

            console.log('🔍 Processing your query...');

            const response = await runRagAgent(query, chatHistory);

            chatHistory.push({ role: 'user', content: query });
            chatHistory.push({ role: 'assistant', content: response });

            console.log('\n🤖 Assistant:', response, '\n');
        }
    } catch (error) {
        console.error('❌ Error running the RAG agent:', error);
    } finally {
        readline.close();
        await closeMongoDBConnection();
    }
}

main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
});

process.on('SIGINT', async () => {
    console.log('\nGracefully shutting down...');
    readline.close();
    await closeMongoDBConnection();
    process.exit(0);
});

process.on('SIGTERM', async () => {
    console.log('\nGracefully shutting down...');
    readline.close();
    await closeMongoDBConnection();
    process.exit(0);
}); 
