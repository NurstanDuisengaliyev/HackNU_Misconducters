import { useCallback, useRef, useState } from 'react'

/**
 * A hook for recording audio from the microphone and sending it to the server for transcription.
 */
export function useVoiceRecorder() {
	const [isRecording, setIsRecording] = useState(false)
	const [isTranscribing, setIsTranscribing] = useState(false)
	const [transcript, setTranscript] = useState('')
	const mediaRecorderRef = useRef<MediaRecorder | null>(null)
	const chunksRef = useRef<Blob[]>([])

	const startRecording = useCallback(async () => {
		try {
			const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
			const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm' })
			mediaRecorderRef.current = recorder
			chunksRef.current = []

			recorder.ondataavailable = (e) => {
				if (e.data.size > 0) {
					chunksRef.current.push(e.data)
				}
			}

			recorder.onstop = async () => {
				const blob = new Blob(chunksRef.current, { type: 'audio/webm' })
				setIsTranscribing(true)
				try {
					const apiUrl = `${window.location.protocol}//${window.location.hostname}:5858/transcribe`
					const response = await fetch(apiUrl, {
						method: 'POST',
						body: blob,
						headers: {
							'Content-Type': 'audio/webm',
						},
					})

					if (!response.ok) {
						throw new Error(`Server error: ${response.statusText}`)
					}

					const data = await response.json()
					if (data.transcript) {
						setTranscript(data.transcript)
					}
				} catch (error) {
					console.error('[useVoiceRecorder] Transcription failed:', error)
				} finally {
					setIsTranscribing(false)
				}
			}

			recorder.start()
			setIsRecording(true)
			setTranscript('')
		} catch (error) {
			console.error('[useVoiceRecorder] Failed to start recording:', error)
		}
	}, [])

	const stopRecording = useCallback(() => {
		if (mediaRecorderRef.current && isRecording) {
			mediaRecorderRef.current.stop()
			// Stop all tracks to release the microphone
			mediaRecorderRef.current.stream.getTracks().forEach((track) => track.stop())
			mediaRecorderRef.current = null
			setIsRecording(false)
		}
	}, [isRecording])

	return {
		isRecording,
		isTranscribing,
		transcript,
		startRecording,
		stopRecording,
	}
}
