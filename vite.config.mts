import react from '@vitejs/plugin-react'
import path from 'path'
import { defineConfig } from 'vite'

export default defineConfig(() => ({
	plugins: [
		react(),
		// SPA fallback: serve index.html for /room/* paths
		{
			name: 'spa-fallback',
			configureServer(server) {
				server.middlewares.use((req, _res, next) => {
					if (req.url?.startsWith('/room/')) {
						req.url = '/'
					}
					next()
				})
			},
		},
	],
	root: path.join(__dirname, 'src/client'),
	publicDir: path.join(__dirname, 'public'),
	build: {
		outDir: path.join(__dirname, 'dist'),
		emptyOutDir: true,
	},
	server: {
		port: 5757,
		host: true,
		proxy: {
			'/stream': {
				target: 'http://localhost:5858',
				changeOrigin: true,
			},
			'/api': {
				target: 'http://localhost:5858',
				changeOrigin: true,
			},
		},
	},
	optimizeDeps: {
		exclude: ['@tldraw/assets'],
	},
}))
