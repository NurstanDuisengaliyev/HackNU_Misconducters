import { AssetRecordType, createShapeId, toRichText, uniqueId } from 'tldraw'
import { TextToImageAction } from '../../shared/schema/AgentActionSchemas'
import { Streaming } from '../../shared/types/Streaming'
import { AgentActionUtil, registerActionUtil } from './AgentActionUtil'

const WORKER_URL = `${window.location.protocol}//${window.location.hostname}:5858`

export const TextToImageActionUtil = registerActionUtil(
	class TextToImageActionUtil extends AgentActionUtil<TextToImageAction> {
		static override type = 'textToImage' as const

		override getInfo(action: Streaming<TextToImageAction>) {
			const description = action.complete
				? `Generated image: "${action.prompt}"`
				: `Generating image: "${action.prompt ?? '...'}"`
			return {
				icon: 'pencil' as const,
				description,
			}
		}

		override async applyAction(action: Streaming<TextToImageAction>) {
			if (!action.complete) return

			const { editor } = this
			const placeholderW = 512
			const placeholderH = 512
			const x = action.x ?? 0
			const y = action.y ?? 0

			// Create a placeholder rectangle while the image generates
			const placeholderId = createShapeId()
			editor.createShape({
				id: placeholderId,
				type: 'geo',
				x,
				y,
				props: {
					w: placeholderW,
					h: placeholderH,
					geo: 'rectangle',
					color: 'grey',
					fill: 'solid',
					dash: 'dashed',
					size: 's',
					richText: toRichText('Higgsfield Generating...'),
					align: 'middle',
					verticalAlign: 'middle',
					font: 'sans',
				},
				meta: { isPending: true, suggestedBy: 'AI', isPlaceholder: true },
			})

			try {
				// Call server endpoint to generate image
				const res = await fetch(`/api/higgsfield/text-to-image`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						prompt: action.prompt,
						aspectRatio: action.aspectRatio || '1:1',
					}),
				})

				if (!res.ok) {
					const err = await res.json().catch(() => ({ error: 'Unknown error' }))
					// Update placeholder to show error
					editor.updateShape({
						id: placeholderId,
						type: 'geo',
						props: {
							color: 'red',
							richText: toRichText(`Generation failed: ${err.error}`),
						},
					})
					return
				}

				const { imageUrl } = await res.json()

				// Download image and upload to local asset store
				const imageRes = await fetch(imageUrl)
				const blob = await imageRes.blob()
				const file = new File([blob], `generated-${uniqueId()}.png`, { type: 'image/png' })

				const assetId = AssetRecordType.createId(uniqueId())
				const objectName = `${uniqueId()}-${file.name}`
				const uploadUrl = `${WORKER_URL}/uploads/${encodeURIComponent(objectName)}`
				const uploadRes = await fetch(uploadUrl, { method: 'PUT', body: file })
				if (!uploadRes.ok) throw new Error('Failed to upload generated image')

				// Create the asset
				editor.createAssets([
					{
						id: assetId,
						type: 'image',
						typeName: 'asset',
						props: {
							name: file.name,
							src: uploadUrl,
							w: placeholderW,
							h: placeholderH,
							mimeType: 'image/png',
							isAnimated: false,
							fileSize: blob.size,
						},
						meta: {},
					},
				])

				// Remove placeholder and create the real image shape
				editor.deleteShape(placeholderId)

				const shapeId = createShapeId()
				editor.createShape({
					id: shapeId,
					type: 'image',
					x,
					y,
					props: {
						assetId,
						w: placeholderW,
						h: placeholderH,
					},
					opacity: 1,
					meta: { isPending: true, suggestedBy: 'AI', originalImageUrl: imageUrl },
				})
			} catch (err: any) {
				// Update placeholder to show error
				editor.updateShape({
					id: placeholderId,
					type: 'geo',
					props: {
						color: 'red',
						richText: toRichText(`Error: ${err.message}`),
					},
				})
			}
		}
	}
)
