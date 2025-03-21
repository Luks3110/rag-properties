import { Document } from '@langchain/core/documents';
import { Annotation, END, START, StateGraph } from '@langchain/langgraph';
import { RagState } from '../types/state';
import {
    composeSearch,
    generateQueryEmbeddings,
    generateResponse,
    handleError,
    retrieveDocuments
} from './nodes';

enum RagNode {
    EMBED = 'embedQuery',
    RETRIEVE = 'retrieveDocuments',
    GENERATE = 'generateResponse',
    ERROR = 'handleError',
    COMPOSE_SEARCH = 'composeSearch'
}

/**
 * Create the RAG agent graph
 */
export function createRagGraph() {
    const RagStateAnnotation = Annotation.Root({
        query: Annotation<string>(),
        queryEmbeddings: Annotation<number[] | undefined>(),
        retrievedDocuments: Annotation<Document[] | undefined>(),
        response: Annotation<string | undefined>(),
        error: Annotation<{ message: string; details?: any } | undefined>(),
        chatHistory: Annotation<{ role: 'user' | 'assistant'; content: string }[]>({
            reducer: (x, y) => x.concat(y),
        }),
    });

    const workflow = new StateGraph(RagStateAnnotation)
        .addNode(RagNode.COMPOSE_SEARCH, composeSearch)
        .addNode(RagNode.EMBED, generateQueryEmbeddings)
        .addNode(RagNode.RETRIEVE, retrieveDocuments)
        .addNode(RagNode.GENERATE, generateResponse)
        .addNode(RagNode.ERROR, handleError)
        .addEdge(START, RagNode.COMPOSE_SEARCH)
        .addEdge(RagNode.COMPOSE_SEARCH, RagNode.EMBED)
        .addConditionalEdges(
            RagNode.EMBED,
            (state: typeof RagStateAnnotation.State) => {
                if (state.error) {
                    return RagNode.ERROR;
                }
                return RagNode.RETRIEVE;
            },
            {
                [RagNode.ERROR]: RagNode.ERROR,
                [RagNode.RETRIEVE]: RagNode.RETRIEVE,
            }
        )
        .addConditionalEdges(
            RagNode.RETRIEVE,
            (state: typeof RagStateAnnotation.State) => {
                if (state.error) {
                    return RagNode.ERROR;
                }
                return RagNode.GENERATE;
            },
            {
                [RagNode.ERROR]: RagNode.ERROR,
                [RagNode.GENERATE]: RagNode.GENERATE,
            }
        )
        .addConditionalEdges(
            RagNode.GENERATE,
            (state: typeof RagStateAnnotation.State) => {
                if (state.error) {
                    return RagNode.ERROR;
                }
                return END;
            },
            {
                [RagNode.ERROR]: RagNode.ERROR,
                [END]: END,
            }
        )
        .addEdge(RagNode.ERROR, END);


    return workflow.compile();
}

/**
 * Run the RAG agent with a user query
 * @param input - User query string
 * @param chatHistory - Previous chat history
 * @returns The agent's response
 */
export async function runRagAgent(
    input: string,
    chatHistory: RagState['chatHistory'] = []
): Promise<string> {
    try {
        const ragGraph = createRagGraph();

        const result = await ragGraph.invoke({
            query: input,
            chatHistory: chatHistory,
        });

        return result.response || "I'm sorry, I couldn't process your request.";
    } catch (error) {
        console.error('Error running RAG agent:', error);
        return "An error occurred while processing your request. Please try again later.";
    }
} 
