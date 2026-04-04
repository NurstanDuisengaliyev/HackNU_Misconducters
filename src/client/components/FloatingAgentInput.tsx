import { useCallback, useEffect, useRef, useState } from 'react'
import { useAgent } from '../agent/TldrawAgentAppProvider'

interface FloatingAgentInputProps {
	onClose: () => void
}

export function FloatingAgentInput({ onClose }: FloatingAgentInputProps) {
	const agent = useAgent()
	const { editor } = agent
	const [value, setValue] = useState('')
	const textareaRef = useRef<HTMLTextAreaElement>(null)

	useEffect(() => {
		textareaRef.current?.focus()
	}, [])

	// Auto-resize textarea
	useEffect(() => {
		const textarea = textareaRef.current
		if (!textarea) return
		textarea.style.height = 'auto'
		textarea.style.height = Math.min(textarea.scrollHeight, 120) + 'px'
	}, [value])

	const handleSubmit = useCallback(() => {
		const text = value.trim()
		if (!text) return

		// Same call as ChatPanel — proven to work with the agent system
		agent.interrupt({
			input: {
				agentMessages: [text],
				bounds: editor.getViewportPageBounds(),
				source: 'user',
				contextItems: agent.context.getItems(),
			},
		})

		setValue('')
		onClose()
	}, [value, agent, editor, onClose])

	const handleKeyDown = useCallback(
		(e: React.KeyboardEvent) => {
			if (e.key === 'Enter' && !e.shiftKey) {
				e.preventDefault()
				handleSubmit()
			}
			if (e.key === 'Escape') {
				onClose()
			}
		},
		[handleSubmit, onClose]
	)

	return (
		<div className="floating-input-backdrop" onClick={onClose}>
			<div className="floating-input" onClick={(e) => e.stopPropagation()}>
				<div className="floating-input-wrapper">
					<textarea
						ref={textareaRef}
						className="floating-input-textarea"
						value={value}
						onChange={(e) => setValue(e.target.value)}
						onKeyDown={handleKeyDown}
						placeholder="Ask AI to brainstorm, organize, connect ideas..."
						rows={1}
					/>
					<button
						className="floating-input-submit"
						onClick={handleSubmit}
						disabled={!value.trim()}
					>
						<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
							<line x1="22" y1="2" x2="11" y2="13" />
							<polygon points="22 2 15 22 11 13 2 9 22 2" />
						</svg>
					</button>
				</div>
				<div className="floating-input-hint">
					Press <kbd>Enter</kbd> to send · <kbd>Esc</kbd> to close
				</div>
			</div>
		</div>
	)
}
