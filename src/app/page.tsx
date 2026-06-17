'use client'

import { useEffect } from 'react'
import dynamic from 'next/dynamic'

const DragonGame = dynamic(() => import('@/components/game/DragonGame'), {
  ssr: false,
  loading: () => (
    <div className="w-full h-screen flex items-center justify-center bg-gray-900">
      <div className="text-center">
        <h1 className="text-4xl font-bold text-amber-500 mb-4" style={{ textShadow: '0 0 30px rgba(217,119,6,0.5)' }}>
          DRAGON&apos;S REIGN
        </h1>
        <p className="text-amber-200/60 animate-pulse">Loading the kingdom...</p>
      </div>
    </div>
  ),
})

function HydrationErrorHandler({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    // Suppress recoverable hydration errors caused by browser extensions
    // (e.g. Securly injecting <div id="securlyOverlay"> before React hydrates)
    const handler = (event: ErrorEvent) => {
      const msg = event.message || ''
      if (msg.includes('Hydration') || msg.includes('securly') || msg.includes('hydrat')) {
        event.preventDefault()
        event.stopPropagation()
        return false
      }
    }
    window.addEventListener('error', handler, true)
    return () => window.removeEventListener('error', handler, true)
  }, [])

  return <>{children}</>
}

export default function Home() {
  return (
    <HydrationErrorHandler>
      <DragonGame />
    </HydrationErrorHandler>
  )
}
