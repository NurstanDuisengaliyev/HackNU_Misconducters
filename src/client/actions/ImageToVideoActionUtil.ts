import { AssetRecordType, createShapeId, uniqueId } from 'tldraw'
import { ImageToVideoAction } from '../../shared/schema/AgentActionSchemas'
import { Streaming } from '../../shared/types/Streaming'
import { AgentActionUtil, registerActionUtil } from './AgentActionUtil'

const IS_DEV = window.location.port === '5757'
const WORKER_URL = IS_DEV ? `${window.location.protocol}//${window.location.hostname}:5858` : ''

export const ImageToVideoActionUtil = registerActionUtil(
	class ImageToVideoActionUtil extends AgentActionUtil<ImageToVideoAction> {
		static override type = 'imageToVideo' as const

		override getInfo(action: Streaming<ImageToVideoAction>) {
			const description = action.complete
				? `Animated image ${action.imageShapeId} into video`
				: `Animating image ${action.imageShapeId ?? '...'}...`
			return {
				icon: 'pencil' as const,
				description,
			}
		}

		override async applyAction(action: Streaming<ImageToVideoAction>) {
			if (!action.complete) return

			const { editor } = this

			// Find the image shape on the canvas
			const fullShapeId = `shape:${action.imageShapeId}`
			const shape = editor.getShape(fullShapeId as any)
			if (!shape || shape.type !== 'image') {
				this.agent.schedule({
					data: [{ error: `Shape ${action.imageShapeId} is not an image or does not exist` }],
				})
				return
			}

			// Try to get the original public Higgsfield URL from shape meta first,
			// then fall back to the asset src (server will handle localhost->public conversion)
			let imageUrl = (shape.meta as any)?.originalImageUrl as string | undefined

			if (!imageUrl) {
				const assetId = (shape.props as any).assetId
				const asset = editor.getAsset(assetId)
				if (!asset || !asset.props.src) {
					this.agent.schedule({
						data: [{ error: `Could not find image asset for shape ${action.imageShapeId}` }],
					})
					return
				}
				imageUrl = asset.props.src as string
			}

			// Save position/size before any modifications
			const origX = shape.x
			const origY = shape.y
			const origW = (shape.props as any).w || 512
			const origH = (shape.props as any).h || 512

			try {
				// Call server endpoint to generate video
				// Server handles localhost URL -> public URL conversion automatically
				console.log('[imageToVideo] Calling server with imageUrl:', imageUrl)
				const res = await fetch(`/api/higgsfield/image-to-video`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						imageUrl,
						prompt: action.prompt,
						duration: action.duration || 5,
					}),
				})

				if (!res.ok) {
					const err = await res.json().catch(() => ({ error: 'Unknown error' }))
					console.error('[imageToVideo] Server error:', err)
					return
				}

				const { videoUrl } = await res.json()
				console.log('[imageToVideo] Video generated:', videoUrl)

				// Download video and upload to local asset store
				const videoRes = await fetch(videoUrl)
				const blob = await videoRes.blob()
				console.log('[imageToVideo] Video downloaded, size:', blob.size)

				const file = new File([blob], `generated-${uniqueId()}.mp4`, { type: 'video/mp4' })
				const newAssetId = AssetRecordType.createId(uniqueId())
				const objectName = `${uniqueId()}-${file.name}`
				const uploadUrl = `${WORKER_URL}/uploads/${encodeURIComponent(objectName)}`

				const uploadRes = await fetch(uploadUrl, { method: 'PUT', body: file })
				if (!uploadRes.ok) {
					console.error('[imageToVideo] Upload failed:', uploadRes.status)
					return
				}
				console.log('[imageToVideo] Video uploaded to:', uploadUrl)

				// Create the video asset
				editor.createAssets([
					{
						id: newAssetId,
						type: 'video',
						typeName: 'asset',
						props: {
							name: file.name,
							src: uploadUrl,
							w: origW,
							h: origH,
							mimeType: 'video/mp4',
							isAnimated: true,
							fileSize: blob.size,
						},
						meta: {},
					},
				])
				console.log('[imageToVideo] Asset created:', newAssetId)

				// Delete the original image shape if it still exists
				const currentShape = editor.getShape(fullShapeId as any)
				if (currentShape) {
					editor.deleteShape(currentShape.id)
					console.log('[imageToVideo] Deleted original shape')
				}

				// Create the video shape at the same position
				const videoShapeId = createShapeId()
				editor.createShape({
					id: videoShapeId,
					type: 'video',
					x: origX,
					y: origY,
					props: {
						assetId: newAssetId,
						w: origW,
						h: origH,
					},
					opacity: 1,
					meta: { suggestedBy: 'AI' },
				})
				console.log('[imageToVideo] Video shape created:', videoShapeId)

			} catch (err: any) {
				console.error('[imageToVideo] Error:', err.message, err.stack)
			}
		}
	}
)
