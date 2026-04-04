import { createAnthropic } from '@ai-sdk/anthropic'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { createOpenAI } from '@ai-sdk/openai'
import { streamText, type LanguageModel, type ModelMessage } from 'ai'
import type { FastifyRequest, FastifyReply } from 'fastify'
import {
	getAgentModelDefinition,
	isValidModelName,
	type AgentModelName,
} from '../shared/models'
import type { AgentAction } from '../shared/types/AgentAction'
import type { AgentPrompt } from '../shared/types/AgentPrompt'
import type { Streaming } from '../shared/types/Streaming'
import { buildMessages } from '../worker/prompt/buildMessages'
import { buildSystemPrompt } from '../worker/prompt/buildSystemPrompt'
import { getModelName } from '../worker/prompt/getModelName'
import { closeAndParseJson } from '../worker/do/closeAndParseJson'

// Initialize AI providers from environment variables
const providers = {
	anthropic: createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY || '' }),
	google: createGoogleGenerativeAI({ apiKey: process.env.GOOGLE_API_KEY || '' }),
	openai: createOpenAI({ apiKey: process.env.OPENAI_API_KEY || '' }),
}

function getModel(modelName: AgentModelName): LanguageModel {
	const def = getAgentModelDefinition(modelName)
	const provider = def.provider
	return providers[provider](def.id)
}

async function* streamActions(prompt: AgentPrompt): AsyncGenerator<Streaming<AgentAction>> {
	const modelName = getModelName(prompt)
	const model = getModel(modelName)
	const provider = (model as any).provider ?? ''
	const modelDef = getAgentModelDefinition(modelName)

	const systemPrompt = buildSystemPrompt(prompt)
	const messages: ModelMessage[] = []

	// System prompt with Anthropic caching
	if (provider === 'anthropic.messages') {
		messages.push({
			role: 'system',
			content: systemPrompt,
			providerOptions: {
				anthropic: { cacheControl: { type: 'ephemeral' } },
			},
		})
	} else {
		messages.push({ role: 'system', content: systemPrompt })
	}

	// Add prompt messages
	messages.push(...buildMessages(prompt))

	// Force the response to start with the actions array
	messages.push({
		role: 'assistant',
		content: '{"actions": [{"_type":',
	})

	const geminiThinkingBudget = modelDef.thinking ? 256 : 0
	const openaiReasoningEffort = provider === 'openai.responses' ? 'none' : 'minimal'

	const { textStream } = streamText({
		model,
		messages,
		maxOutputTokens: 8192,
		temperature: 0,
		providerOptions: {
			anthropic: { thinking: { type: 'disabled' } },
			google: { thinkingConfig: { thinkingBudget: geminiThinkingBudget } },
			openai: { reasoningEffort: openaiReasoningEffort },
		},
		onError: (e) => {
			console.error('Stream text error:', e)
			throw e
		},
	})

	const canForceResponseStart =
		provider === 'anthropic.messages' || provider === 'google.generative-ai'
	let buffer = canForceResponseStart ? '{"actions": [{"_type":' : ''
	let cursor = 0
	let maybeIncompleteAction: AgentAction | null = null
	let startTime = Date.now()

	for await (const text of textStream) {
		buffer += text

		const partialObject = closeAndParseJson(buffer)
		if (!partialObject) continue

		const actions = partialObject.actions
		if (!Array.isArray(actions) || actions.length === 0) continue

		if (actions.length > cursor) {
			const action = actions[cursor - 1] as AgentAction
			if (action) {
				yield { ...action, complete: true, time: Date.now() - startTime }
				maybeIncompleteAction = null
			}
			cursor++
		}

		const action = actions[cursor - 1] as AgentAction
		if (action) {
			if (!maybeIncompleteAction) startTime = Date.now()
			maybeIncompleteAction = action
			yield { ...action, complete: false, time: Date.now() - startTime }
		}
	}

	if (maybeIncompleteAction) {
		yield { ...maybeIncompleteAction, complete: true, time: Date.now() - startTime }
	}
}

export async function agentStreamHandler(req: FastifyRequest, reply: FastifyReply) {
	const prompt = req.body as AgentPrompt

	console.log('[agent] Received stream request')
	console.log('[agent] Prompt keys:', Object.keys(prompt))

	reply.raw.writeHead(200, {
		'Content-Type': 'text/event-stream',
		'Cache-Control': 'no-cache, no-transform',
		Connection: 'keep-alive',
		'X-Accel-Buffering': 'no',
		'Access-Control-Allow-Origin': '*',
	})

	try {
		let actionCount = 0
		for await (const action of streamActions(prompt)) {
			actionCount++
			console.log(`[agent] Action #${actionCount}:`, action._type, action.complete ? '(complete)' : '(partial)')
			const data = `data: ${JSON.stringify(action)}\n\n`
			reply.raw.write(data)
		}
		console.log(`[agent] Stream finished. Total actions: ${actionCount}`)
	} catch (error: any) {
		console.error('[agent] Stream error:', error.message)
		console.error('[agent] Full error:', error)
		const errorData = `data: ${JSON.stringify({ error: error.message })}\n\n`
		reply.raw.write(errorData)
	}

	reply.raw.end()
}
