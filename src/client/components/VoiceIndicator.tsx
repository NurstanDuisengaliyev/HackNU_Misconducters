import { AnimatePresence, motion } from 'framer-motion'
import { Mic, Loader2 } from 'lucide-react'
import React, { useEffect, useState } from 'react'

interface VoiceIndicatorProps {
	transcript: string
	isRecording: boolean
	isTranscribing: boolean
}

/**
 * A sophisticated floating indicator for voice recording and Gemini transcription.
 */
export function VoiceIndicator({ transcript, isRecording, isTranscribing }: VoiceIndicatorProps) {
	const [time, setTime] = useState(0)

	useEffect(() => {
		let intervalId: any
		if (isRecording) {
			intervalId = setInterval(() => {
				setTime((t) => t + 1)
			}, 1000)
		} else {
			setTime(0)
		}
		return () => clearInterval(intervalId)
	}, [isRecording])

	const formatTime = (seconds: number) => {
		const mins = Math.floor(seconds / 60)
		const secs = seconds % 60
		return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
	}

	return (
		<div className="voice-input-container">
			<AnimatePresence>
				{(transcript || isTranscribing) && (
					<motion.div
						initial={{ opacity: 0, y: 10, scale: 0.95 }}
						animate={{ opacity: 1, y: 0, scale: 1 }}
						exit={{ opacity: 0, y: 10, scale: 0.95 }}
						className="voice-transcript-floating"
					>
						{isTranscribing ? (
							<div className="flex items-center gap-2">
								<Loader2 className="h-4 w-4 animate-spin" />
								<span>Gemini is transcribing...</span>
							</div>
						) : (
							transcript
						)}
					</motion.div>
				)}
			</AnimatePresence>

			<motion.div
				className="voice-pill"
				layout
				transition={{
					layout: {
						duration: 0.4,
						ease: [0.23, 1, 0.32, 1],
					},
				}}
			>
				<div className="voice-mic-container">
					{isRecording ? (
						<motion.div
							className="voice-stop-square"
							animate={{
								rotate: [0, 90, 180, 270, 360],
								scale: [1, 1.1, 1],
								borderRadius: ['20%', '50%', '20%'],
							}}
							transition={{
								duration: 2,
								repeat: Infinity,
								ease: 'easeInOut',
							}}
						/>
					) : isTranscribing ? (
						<Loader2 className="h-5 w-5 animate-spin color-primary" />
					) : (
						<Mic size={20} />
					)}
				</div>

				<AnimatePresence mode="wait">
					{isRecording && (
						<motion.div
							initial={{ opacity: 0, width: 0 }}
							animate={{ opacity: 1, width: 'auto' }}
							exit={{ opacity: 0, width: 0 }}
							transition={{
								duration: 0.4,
								ease: 'easeInOut',
							}}
							className="voice-content"
						>
							<div className="voice-bars">
								{[...Array(12)].map((_, i) => (
									<motion.div
										key={i}
										className="voice-bar"
										initial={{ height: 4 }}
										animate={{
											height: [4, 4 + Math.random() * 16, 4 + Math.random() * 8, 4],
										}}
										transition={{
											duration: 1,
											repeat: Infinity,
											delay: i * 0.05,
											ease: 'easeInOut',
										}}
									/>
								))}
							</div>
							<div className="voice-timer">{formatTime(time)}</div>
						</motion.div>
					)}
				</AnimatePresence>
			</motion.div>
		</div>
	)
}
