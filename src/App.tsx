import { lazy, Suspense } from 'react'
import { Galaxy } from '@/components/Galaxy'
import { Nav } from '@/components/Nav'
import { Footer } from '@/components/Footer'
import { PaymentSheet } from '@/components/premium/PaymentSheet'
import { Link, usePath } from '@/lib/router'
import { useI18n } from '@/i18n'
import Home from '@/pages/Home'
import Dashboard from '@/pages/Dashboard'

const Editor = lazy(() => import('@/pages/Editor'))
const Collage = lazy(() => import('@/pages/Collage'))
const Compress = lazy(() => import('@/pages/Compress'))
const Convert = lazy(() => import('@/pages/Convert'))
const SwapBridge = lazy(() => import('@/pages/SwapBridge'))
const Premium = lazy(() => import('@/pages/Premium'))

function NotFound() {
  const { t } = useI18n()
  return (
    <div className="gp-page mx-auto max-w-md px-4 py-24 text-center">
      <p className="gp-eyebrow">404</p>
      <h1 className="font-display mt-2 text-3xl font-bold">{t('notfound.title')}</h1>
      <Link to="/" className="gp-btn gp-btn-primary mt-8">
        {t('notfound.back')}
      </Link>
    </div>
  )
}

function Route({ path }: { path: string }) {
  if (path === '/convert' || path.startsWith('/convert/')) return <Convert />
  switch (path) {
    case '/':
      return <Home />
    case '/tools':
      return <Dashboard />
    case '/editor':
      return <Editor />
    case '/collage':
      return <Collage />
    case '/compress':
      return <Compress />
    case '/convert':
      return <Convert />
    case '/swap-bridge':
      return <SwapBridge />
    case '/premium':
      return <Premium />
    default:
      return <NotFound />
  }
}

export default function App() {
  const path = usePath()
  const { t } = useI18n()
  return (
    <div className="relative min-h-dvh">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-black focus:px-4 focus:py-2 focus:text-[var(--gp-gold)]">
        {t('a11y.skip')}
      </a>
      <Galaxy />
      <Nav />
      <main id="main">
        <Suspense fallback={<div className="grid min-h-[50vh] place-items-center text-sm text-mist">{t('common.loading')}</div>}>
          <Route path={path} />
        </Suspense>
      </main>
      <Footer />
      <PaymentSheet />
    </div>
  )
}
