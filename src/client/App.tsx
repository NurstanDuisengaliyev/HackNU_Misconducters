import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSync } from '@tldraw/sync'
import {
	DefaultSizeStyle,
	TLAssetStore,
	TLComponents,
	Tldraw,
	TldrawOverlays,
	TldrawUiToastsProvider,
	TLUiOverrides,
	uniqueId,
	Editor,
} from 'tldraw'
import { TldrawAgentApp } from './agent/TldrawAgentApp'
import {
	TldrawAgentAppContextProvider,
	TldrawAgentAppProvider,
} from './agent/TldrawAgentAppProvider'
import { CustomHelperButtons } from './components/CustomHelperButtons'
import { AgentViewportBoundsHighlights } from './components/highlights/AgentViewportBoundsHighlights'
import { AllContextHighlights } from './components/highlights/ContextHighlights'
import { FloatingAgentInput } from './components/FloatingAgentInput'
import { TargetAreaTool } from './tools/TargetAreaTool'
import { TargetShapeTool } from './tools/TargetShapeTool'

const WORKER_URL = `${window.location.protocol}//${window.location.hostname}:5858`
const roomId = 'test-room'

DefaultSizeStyle.setDefaultValue('s')

const tools = [TargetShapeTool, TargetAreaTool]
const overrides: TLUiOverrides = {
	tools: (editor, tools) => {
		return {
			...tools,
			'target-area': {
				id: 'target-area',
				label: 'Pick Area',
				kbd: 'c',
				icon: 'tool-frame',
				onSelect() {
					editor.setCurrentTool('target-area')
				},
			},
			'target-shape': {
				id: 'target-shape',
				label: 'Pick Shape',
				kbd: 's',
				icon: 'tool-frame',
				onSelect() {
					editor.setCurrentTool('target-shape')
				},
			},
		}
	},
}

function App() {
	const [app, setApp] = useState<TldrawAgentApp | null>(null)
	const [editor, setEditor] = useState<Editor | null>(null)
	const [isChatOpen, setIsChatOpen] = useState(false)

	const handleMount = useCallback((a: TldrawAgentApp) => {
		setApp(a)
		setEditor(a.editor)
	}, [])

	const handleUnmount = useCallback(() => {
		setApp(null)
		setEditor(null)
	}, [])

	// Keyboard shortcut: "/" opens AI chat
	useEffect(() => {
		const handleKeyDown = (e: KeyboardEvent) => {
			if (e.key === '/' && !isChatOpen && !(e.target as HTMLElement)?.closest('input, textarea')) {
				e.preventDefault()
				setIsChatOpen(true)
			}
		}
		window.addEventListener('keydown', handleKeyDown)
		return () => window.removeEventListener('keydown', handleKeyDown)
	}, [isChatOpen])

	const store = useSync({
		uri: `${WORKER_URL}/connect/${roomId}`,
		assets: multiplayerAssets,
	})

	// Custom components — kept identical to working version
	const components: TLComponents = useMemo(() => {
		return {
			HelperButtons: () =>
				app && (
					<TldrawAgentAppContextProvider app={app}>
						<CustomHelperButtons />
					</TldrawAgentAppContextProvider>
				),
			Overlays: () => (
				<>
					<TldrawOverlays />
					{app && (
						<TldrawAgentAppContextProvider app={app}>
							<AgentViewportBoundsHighlights />
							<AllContextHighlights />
						</TldrawAgentAppContextProvider>
					)}
				</>
			),
		}
	}, [app])

	return (
		<TldrawUiToastsProvider>
			<div className="tldraw-agent-container">
				<div className="tldraw-canvas">
					<Tldraw
						store={store}
						tools={tools}
						overrides={overrides}
						components={components}
					>
						<TldrawAgentAppProvider
							onMount={handleMount}
							onUnmount={handleUnmount}
						/>
					</Tldraw>
				</div>
			</div>

			{/* Floating AI button */}
			<button
				className="ai-fab"
				onClick={() => setIsChatOpen(true)}
				title="AI Agent (press /)"
			>
				<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
					<path d="M12 2a4 4 0 0 1 4 4v2a4 4 0 0 1-8 0V6a4 4 0 0 1 4-4z" />
					<path d="M18 14a6 6 0 0 1-12 0" />
					<line x1="12" y1="20" x2="12" y2="22" />
					<line x1="8" y1="22" x2="16" y2="22" />
				</svg>
			</button>

			{/* Floating chat input — wrapped in agent context provider */}
			{isChatOpen && app && (
				<TldrawAgentAppContextProvider app={app}>
					<FloatingAgentInput onClose={() => setIsChatOpen(false)} />
				</TldrawAgentAppContextProvider>
			)}

			{/* Approval overlay for ghost shapes — outside tldraw, uses polling */}
			{editor && <ApprovalOverlay editor={editor} />}
		</TldrawUiToastsProvider>
	)
}

// Approval overlay — uses setInterval polling, NOT tldraw reactive hooks
function ApprovalOverlay({ editor }: { editor: Editor }) {
	const [pendingShapes, setPendingShapes] = useState<{ id: string; screenX: number; screenY: number }[]>([])

	useEffect(() => {
		const interval = setInterval(() => {
			try {
				const shapes = editor.getCurrentPageShapes()
				const pending: { id: string; screenX: number; screenY: number }[] = []
				for (const shape of shapes) {
					if ((shape.meta as any)?.isPending) {
						const bounds = editor.getShapePageBounds(shape)
						if (!bounds) continue
						const pt = editor.pageToScreen({ x: bounds.maxX, y: bounds.minY })
						pending.push({ id: shape.id, screenX: pt.x, screenY: pt.y })
					}
				}
				setPendingShapes(pending)
			} catch (_) {}
		}, 500)
		return () => clearInterval(interval)
	}, [editor])

	if (pendingShapes.length === 0) return null

	return (
		<>
			{pendingShapes.map((s) => (
				<div key={s.id} className="approval-buttons" style={{ left: s.screenX + 4, top: s.screenY - 4 }}>
					<button className="approval-btn approval-accept" onClick={() => {
						const shape = editor.getShape(s.id as any)
						if (shape) editor.updateShape({ id: s.id as any, type: shape.type, meta: { isPending: false }, opacity: 1 })
					}} title="Accept">&#10003;</button>
					<button className="approval-btn approval-reject" onClick={() => {
						editor.deleteShape(s.id as any)
					}} title="Reject">&#10007;</button>
				</div>
			))}
			{pendingShapes.length > 1 && (
				<div className="approval-all-bar">
					<span>{pendingShapes.length} AI suggestions</span>
					<button className="approval-btn approval-accept" onClick={() => {
						const shapes = editor.getCurrentPageShapes().filter((s) => (s.meta as any)?.isPending)
						editor.updateShapes(shapes.map((s) => ({ id: s.id, type: s.type, meta: { isPending: false }, opacity: 1 })))
					}}>&#10003; Accept All</button>
					<button className="approval-btn approval-reject" onClick={() => {
						const shapes = editor.getCurrentPageShapes().filter((s) => (s.meta as any)?.isPending)
						editor.deleteShapes(shapes.map((s) => s.id))
					}}>&#10007; Reject All</button>
				</div>
			)}
		</>
	)
}

const multiplayerAssets: TLAssetStore = {
	async upload(_asset, file) {
		const id = uniqueId()
		const objectName = `${id}-${file.name}`
		const url = `${WORKER_URL}/uploads/${encodeURIComponent(objectName)}`
		const response = await fetch(url, { method: 'PUT', body: file })
		if (!response.ok) throw new Error(`Failed to upload asset: ${response.statusText}`)
		return { src: url }
	},
	resolve(asset) {
		return asset.props.src
	},
}

export default App
