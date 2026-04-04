import { useEffect, useRef } from 'react'
import { useAgent } from '../agent/TldrawAgentAppProvider'

/**
 * Watches for new user-created shapes on the canvas.
 * When detected and user stops editing, proactively suggests related ideas.
 */
export function ProactiveWatcher() {
	const agent = useAgent()
	const { editor } = agent
	const processedShapeIdsRef = useRef<Set<string>>(new Set())
	const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
	const cooldownRef = useRef(false)
	const lastSnapshotRef = useRef<Map<string, string>>(new Map()) // id -> text

	useEffect(() => {
		// Initialize with current shapes so we don't trigger on existing ones
		const currentShapes = editor.getCurrentPageShapes()
		for (const shape of currentShapes) {
			processedShapeIdsRef.current.add(shape.id)
		}
		console.log('[Proactive] Watcher mounted, ignoring', processedShapeIdsRef.current.size, 'existing shapes')

		const interval = setInterval(() => {
			try {
				const shapes = editor.getCurrentPageShapes()

				// Build current text snapshot
				const currentSnapshot = new Map<string, string>()
				for (const shape of shapes) {
					// Skip AI shapes
					if ((shape.meta as any)?.suggestedBy === 'AI') continue
					// Skip already processed
					if (processedShapeIdsRef.current.has(shape.id)) continue

					let text = ''
					const props = shape.props as any
					if (props?.text) {
						text = props.text
					} else if (props?.richText) {
						try {
							const content = props.richText.content
							if (Array.isArray(content)) {
								text = content.map((block: any) =>
									block.content?.map((inline: any) => inline.text || '').join('') || ''
								).join('\n')
							}
						} catch (_) {}
					}

					if (text.trim()) {
						currentSnapshot.set(shape.id, text.trim())
					}
				}

				// Check if text changed since last poll — if yes, user is still typing
				let textChanged = false
				for (const [id, text] of currentSnapshot) {
					if (lastSnapshotRef.current.get(id) !== text) {
						textChanged = true
						break
					}
				}

				// Also check for new shapes since last poll
				const hasNew = currentSnapshot.size !== lastSnapshotRef.current.size

				lastSnapshotRef.current = currentSnapshot

				// If text changed or new shapes appeared, reset the debounce
				if ((textChanged || hasNew) && currentSnapshot.size > 0) {
					if (debounceTimerRef.current) {
						clearTimeout(debounceTimerRef.current)
					}

					debounceTimerRef.current = setTimeout(() => {
						if (cooldownRef.current) {
							console.log('[Proactive] On cooldown, skipping')
							return
						}

						try {
							if (agent.requests.isGenerating()) {
								console.log('[Proactive] Agent busy, skipping')
								return
							}
						} catch (_) {}

						// Get current unprocessed shapes with stable text
						const finalShapes: { id: string; text: string }[] = []
						for (const [id, text] of lastSnapshotRef.current) {
							finalShapes.push({ id, text })
							processedShapeIdsRef.current.add(id) // Mark as processed
						}

						if (finalShapes.length === 0) return

						const shapeTexts = finalShapes.map((s) => `"${s.text}"`).join(', ')
						console.log('[Proactive] User finished typing:', shapeTexts)
						console.log('[Proactive] Suggesting related ideas...')

						// Cooldown 15 seconds
						cooldownRef.current = true
						setTimeout(() => {
							cooldownRef.current = false
							console.log('[Proactive] Cooldown ended, ready again')
						}, 10000)

						agent.interrupt({
							input: {
								agentMessages: [
									`The user just added this to the canvas: ${shapeTexts}. ` +
									`As a proactive brainstorming teammate, contribute meaningfully. ` +
									`Pick the BEST format for the content:\n` +
									`- DIAGRAM/FLOWCHART: if the topic involves a process, system, or relationships\n` +
									`- MIND MAP: if the topic is broad and can branch into subtopics\n` +
									`- TIMELINE: if the topic involves events over time\n` +
									`- STICKY NOTES: if the topic just needs a few related ideas or brainstorming\n` +
									`- LIST/TABLE: if comparing items or listing facts\n` +
									`Use your judgment — match the format to the content. ` +
									`Place new content near the user's shapes.`,
								],
								bounds: editor.getViewportPageBounds(),
								source: 'user',
							},
						})
					}, 3500) // Wait 4 seconds of NO changes before firing
				}
			} catch (_) {}
		}, 2000) // Poll every 2 seconds

		return () => {
			clearInterval(interval)
			if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current)
		}
	}, [editor, agent])

	return null
}
