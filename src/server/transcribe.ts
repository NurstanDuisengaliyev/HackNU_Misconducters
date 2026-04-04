import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { generateText } from 'ai'
import type { FastifyRequest, FastifyReply } from 'fastify'

// Initialize Google AI provider
const google = createGoogleGenerativeAI({ apiKey: process.env.GOOGLE_API_KEY || '' })

/**
 * Handle transcription requests by sending audio data to Gemini 1.5 Flash.
 */
export async function transcribeHandler(req: FastifyRequest, reply: FastifyReply) {
	// Raw body parser in server.ts provides the body as req.body
	const audioBuffer = req.body as Buffer

	if (!audioBuffer || audioBuffer.length === 0) {
		reply.status(400).send({ error: 'No audio data received' })
		return
	}

	console.log(`[transcribe] Received audio buffer of size: ${audioBuffer.length} bytes`)

	try {
		const { text } = await generateText({
			model: google('gemini-1.5-flash'),
			messages: [
				{
					role: 'user',
					content: [
						{ type: 'text', text: 'Transcribe this instruction precisely.' },
						{
							type: 'file',
							data: new Uint8Array(audioBuffer),
							mimeType: 'audio/webm',
						} as any,
					],
				},
			],
		})

		const transcript = text.trim()
		console.log(`[transcribe] Transcript: ${transcript}`)
		reply.send({ transcript })
	} catch (error: any) {
		console.error('[transcribe] Error during Gemini transcription:', error.message)
		reply.status(500).send({ error: `Failed to transcribe audio: ${error.message}` })
	}
}
