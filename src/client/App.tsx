import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
import { ProactiveWatcher } from './components/ProactiveWatcher'
import { TargetAreaTool } from './tools/TargetAreaTool'
import { TargetShapeTool } from './tools/TargetShapeTool'

// In dev: separate ports (5757 client, 5858 server). In prod: same origin.
const IS_DEV = window.location.port === '5757'
const WORKER_URL = IS_DEV ? `${window.location.protocol}//${window.location.hostname}:5858` : window.location.origin

// Dynamic room from URL: /room/my-team → "my-team", / → generate random room
function getRoomId(): string {
	const match = window.location.pathname.match(/^\/room\/(.+)/)
	if (match) return match[1]
	// No room in URL → generate one and redirect
	const id = Math.random().toString(36).slice(2, 8)
	window.history.replaceState(null, '', `/room/${id}`)
	return id
}

// Prompt for user name (cached in localStorage)
function getUserName(): string {
	let name = localStorage.getItem('tldraw-user-name')
	if (!name) {
		name = prompt('Enter your name:') || 'Anonymous'
		localStorage.setItem('tldraw-user-name', name)
	}
	return name
}

const roomId = getRoomId()
const userName = getUserName()

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
	const [isRecording, setIsRecording] = useState(false)
	const [isProactive, setIsProactive] = useState(() => localStorage.getItem('proactive-mode') === 'true')
	const [speechLang, setSpeechLang] = useState('en-US')
	const recognitionRef = useRef<any>(null)

	const handleMount = useCallback((a: TldrawAgentApp) => {
		setApp(a)
		setEditor(a.editor)
		// Set user name — shows on cursor for all multiplayer users
		a.editor.user.updateUserPreferences({ name: userName })
	}, [])

	const handleUnmount = useCallback(() => {
		setApp(null)
		setEditor(null)
	}, [])

	const handleMicToggle = useCallback(() => {
		console.log('[Voice] Mic toggle clicked. isRecording:', isRecording)

		if (isRecording) {
			console.log('[Voice] Stopping recording...')
			recognitionRef.current?.stop()
			setIsRecording(false)
			return
		}

		const SpeechRecognition = (window as any).webkitSpeechRecognition || (window as any).SpeechRecognition
		if (!SpeechRecognition) {
			console.error('[Voice] SpeechRecognition not supported')
			alert('Speech recognition not supported in this browser. Use Chrome.')
			return
		}

		console.log('[Voice] Starting recognition...')
		const recognition = new SpeechRecognition()
		recognition.continuous = true
		recognition.interimResults = true
		recognition.lang = speechLang

		let transcript = ''

		recognition.onstart = () => {
			console.log('[Voice] Recognition started')
		}

		recognition.onresult = (event: any) => {
			let interim = ''
			for (let i = event.resultIndex; i < event.results.length; i++) {
				const result = event.results[i]
				if (result.isFinal) {
					transcript += result[0].transcript + ' '
					console.log('[Voice] Final result:', result[0].transcript)
				} else {
					interim += result[0].transcript
				}
			}
			if (interim) {
				console.log('[Voice] Interim:', interim)
			}
		}

		recognition.onend = () => {
			console.log('[Voice] Recognition ended. Full transcript:', transcript)
			setIsRecording(false)
			const text = transcript.trim()
			if (!text) {
				console.warn('[Voice] No text captured')
				return
			}
			if (!app) {
				console.error('[Voice] No app instance')
				return
			}
			const agent = app.agents.getAgent()
			if (!agent) {
				console.error('[Voice] No agent instance')
				return
			}
			console.log('[Voice] Sending to agent:', text)
			agent.interrupt({
				input: {
					agentMessages: [text],
					bounds: agent.editor.getViewportPageBounds(),
					source: 'user',
					contextItems: agent.context.getItems(),
				},
			})
		}

		recognition.onerror = (event: any) => {
			console.error('[Voice] Recognition error:', event.error, event)
			setIsRecording(false)
		}

		recognition.start()
		recognitionRef.current = recognition
		setIsRecording(true)
		console.log('[Voice] Recognition started, listening...')
	}, [isRecording, app, speechLang])

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
						licenseKey={import.meta.env.VITE_TLDRAW_LICENSE_KEY}
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

			{/* Proactive mode toggle */}
			<button
				className={`ai-fab ai-proactive ${isProactive ? 'active' : ''}`}
				onClick={() => {
					const next = !isProactive
					setIsProactive(next)
					localStorage.setItem('proactive-mode', String(next))
				}}
				title={isProactive ? 'Proactive mode ON' : 'Proactive mode OFF'}
			>
				<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
					<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z" />
					<circle cx="12" cy="12" r="3" />
				</svg>
			</button>

			{/* New room button — top left */}
			<button
				className="ai-fab ai-new-room"
				onClick={() => {
					const id = Math.random().toString(36).slice(2, 8)
					window.location.href = `/room/${id}`
				}}
				title="New room"
			>
				<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
					<line x1="12" y1="5" x2="12" y2="19" />
					<line x1="5" y1="12" x2="19" y2="12" />
				</svg>
			</button>

			{/* AI toolbar buttons */}
			<div className="ai-toolbar-group">
				{/* Chat button (Lucide message-square icon) */}
				<button
					className="ai-fab"
					onClick={() => setIsChatOpen(true)}
					title="AI Chat (press /)"
				>
					<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
						<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
					</svg>
				</button>

				{/* Language selector */}
				<select
					className="ai-lang-select"
					value={speechLang}
					onChange={(e) => setSpeechLang(e.target.value)}
					title="Speech language"
				>
					<option value="en-US">EN</option>
					<option value="ru-RU">RU</option>
					<option value="kk-KZ">KZ</option>
				</select>

				{/* Mic button (Lucide mic icon) */}
				<button
					className={`ai-fab ai-mic ${isRecording ? 'recording' : ''}`}
					onClick={handleMicToggle}
					title={isRecording ? 'Stop recording' : 'Voice input'}
				>
					<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
						<path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" />
						<path d="M19 10v2a7 7 0 0 1-14 0v-2" />
						<line x1="12" y1="19" x2="12" y2="22" />
					</svg>
				</button>
			</div>

			{/* Proactive watcher — only when enabled */}
			{isProactive && app && (
				<TldrawAgentAppContextProvider app={app}>
					<ProactiveWatcher />
				</TldrawAgentAppContextProvider>
			)}

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
