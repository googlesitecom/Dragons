'use client'

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

export default function Home() {
  return <DragonGame />
}
