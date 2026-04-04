import react from '@vitejs/plugin-react'
import path from 'path'
import { defineConfig } from 'vite'

export default defineConfig(() => ({
	plugins: [react()],
	root: path.join(__dirname, 'src/client'),
	publicDir: path.join(__dirname, 'public'),
	server: {
		port: 5757,
		host: true,
		proxy: {
			'/stream': {
				target: 'http://localhost:5858',
				changeOrigin: true,
			},
		},
	},
	optimizeDeps: {
		exclude: ['@tldraw/assets'],
	},
}))
