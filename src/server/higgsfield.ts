import type { FastifyRequest, FastifyReply } from 'fastify'
import { loadAsset } from './assets'

const HIGGSFIELD_BASE_URL = 'https://platform.higgsfield.ai'
const TEXT_TO_IMAGE_MODEL = 'higgsfield-ai/soul/standard'
const IMAGE_TO_VIDEO_MODEL = 'kling-video/v2.1/pro/image-to-video'

function getAuthHeader(): string {
	const key = process.env.HIGGSFIELD_API_KEY
	const secret = process.env.HIGGSFIELD_API_SECRET
	if (!key || !secret) {
		throw new Error('HIGGSFIELD_API_KEY and HIGGSFIELD_API_SECRET must be set')
	}
	return `Key ${key}:${secret}`
}

async function pollForCompletion(statusUrl: string, maxAttempts = 120): Promise<any> {
	const auth = getAuthHeader()
	for (let i = 0; i < maxAttempts; i++) {
		await new Promise((resolve) => setTimeout(resolve, 2000))
		const res = await fetch(statusUrl, {
			headers: {
				Authorization: auth,
				Accept: 'application/json',
			},
		})
		if (!res.ok) {
			throw new Error(`Status check failed: ${res.status} ${res.statusText}`)
		}
		const data = await res.json()
		if (data.status === 'completed') return data
		if (data.status === 'failed' || data.status === 'nsfw') {
			throw new Error(`Generation failed with status: ${data.status}`)
		}
	}
	throw new Error('Generation timed out')
}

/**
 * If the URL is a local uploads URL, read the file from disk
 * and upload it to a temporary public host so Higgsfield can access it.
 */
async function resolveToPublicUrl(imageUrl: string): Promise<string> {
	// If already a public URL, return as-is
	if (!imageUrl.includes('localhost') && !imageUrl.includes('127.0.0.1')) {
		return imageUrl
	}

	console.log(`[higgsfield] Local URL detected, uploading to public host...`)

	// Extract the asset ID from the URL (e.g., /uploads/some-id-here)
	const uploadsMatch = imageUrl.match(/\/uploads\/([^?#]+)/)
	if (!uploadsMatch) {
		throw new Error(`Cannot resolve local URL: ${imageUrl}`)
	}

	const assetId = decodeURIComponent(uploadsMatch[1])
	const fileBuffer = await loadAsset(assetId)

	// Upload to catbox.moe to get a public URL
	const formData = new FormData()
	formData.append('reqtype', 'fileupload')
	formData.append('fileToUpload', new Blob([fileBuffer], { type: 'image/png' }), 'image.png')

	const uploadRes = await fetch('https://catbox.moe/user/api.php', {
		method: 'POST',
		body: formData,
	})

	if (!uploadRes.ok) {
		const text = await uploadRes.text()
		throw new Error(`Failed to upload to public host: ${uploadRes.status} ${text}`)
	}

	const publicUrl = (await uploadRes.text()).trim()
	if (!publicUrl.startsWith('https://')) {
		throw new Error(`Unexpected response from public host: ${publicUrl}`)
	}
	console.log(`[higgsfield] Uploaded to public URL: ${publicUrl}`)
	return publicUrl
}

export async function textToImageHandler(req: FastifyRequest, reply: FastifyReply) {
	const { prompt, aspectRatio } = req.body as { prompt: string; aspectRatio?: string }

	if (!prompt) {
		reply.status(400).send({ error: 'prompt is required' })
		return
	}

	console.log(`[higgsfield] Text-to-image request: "${prompt}"`)

	try {
		const auth = getAuthHeader()
		const res = await fetch(`${HIGGSFIELD_BASE_URL}/${TEXT_TO_IMAGE_MODEL}`, {
			method: 'POST',
			headers: {
				Authorization: auth,
				'Content-Type': 'application/json',
				Accept: 'application/json',
			},
			body: JSON.stringify({
				prompt,
				aspect_ratio: aspectRatio || '1:1',
				resolution: '720p',
			}),
		})

		const data = await res.json().catch(() => null)

		if (!res.ok) {
			const detail = data?.detail || data?.error || `HTTP ${res.status}`
			throw new Error(`Higgsfield API error: ${detail}`)
		}

		if (!data?.request_id || !data?.status_url) {
			throw new Error(`Unexpected Higgsfield response: ${JSON.stringify(data)}`)
		}

		console.log(`[higgsfield] Queued: ${data.request_id}`)

		const result = await pollForCompletion(data.status_url)
		const imageUrl = result.images?.[0]?.url
		if (!imageUrl) {
			throw new Error('No image URL in response')
		}

		console.log(`[higgsfield] Image generated: ${imageUrl}`)
		reply.send({ imageUrl })
	} catch (error: any) {
		console.error('[higgsfield] Text-to-image error:', error.message)
		reply.status(500).send({ error: error.message })
	}
}

export async function imageToVideoHandler(req: FastifyRequest, reply: FastifyReply) {
	const { imageUrl, prompt, duration } = req.body as {
		imageUrl: string
		prompt?: string
		duration?: number
	}

	if (!imageUrl) {
		reply.status(400).send({ error: 'imageUrl is required' })
		return
	}

	console.log(`[higgsfield] Image-to-video request for: ${imageUrl}`)

	try {
		// Resolve localhost URLs to public URLs so Higgsfield can access them
		const publicImageUrl = await resolveToPublicUrl(imageUrl)

		const auth = getAuthHeader()
		const body: Record<string, any> = {
			image_url: publicImageUrl,
			duration: duration || 5,
		}
		if (prompt) body.prompt = prompt

		const res = await fetch(`${HIGGSFIELD_BASE_URL}/${IMAGE_TO_VIDEO_MODEL}`, {
			method: 'POST',
			headers: {
				Authorization: auth,
				'Content-Type': 'application/json',
				Accept: 'application/json',
			},
			body: JSON.stringify(body),
		})

		const data = await res.json().catch(() => null)

		if (!res.ok) {
			const detail = data?.detail || data?.error || `HTTP ${res.status}`
			throw new Error(`Higgsfield API error: ${detail}`)
		}

		if (!data?.request_id || !data?.status_url) {
			throw new Error(`Unexpected Higgsfield response: ${JSON.stringify(data)}`)
		}

		console.log(`[higgsfield] Queued: ${data.request_id}`)

		const result = await pollForCompletion(data.status_url)
		const videoUrl = result.video?.url
		if (!videoUrl) {
			throw new Error('No video URL in response')
		}

		console.log(`[higgsfield] Video generated: ${videoUrl}`)
		reply.send({ videoUrl })
	} catch (error: any) {
		console.error('[higgsfield] Image-to-video error:', error.message)
		reply.status(500).send({ error: error.message })
	}
}
