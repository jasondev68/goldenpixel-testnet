import { ArrowUpRight } from 'lucide-react'
import { Link } from '@/lib/router'
import { useI18n } from '@/i18n'
import type { Tool } from '@/lib/tools'

export function ToolCard({ tool, index = 0 }: { tool: Tool; index?: number }) {
  const { t } = useI18n()
  const Icon = tool.icon
  return (
    <Link
      to={tool.path}
      className="gp-card gp-card-hover group flex h-full flex-col p-6 gp-page"
      style={{ animationDelay: `${index * 70}ms` }}
    >
      <div className="flex items-start justify-between">
        <span className="grid h-12 w-12 place-items-center rounded-2xl border border-[var(--gp-line-strong)] bg-[rgba(245,197,66,0.08)] text-[var(--gp-gold)] transition-shadow duration-300 group-hover:shadow-[0_0_24px_rgba(245,197,66,0.45)]">
          <Icon size={22} />
        </span>
        <ArrowUpRight size={18} className="text-mist transition-all duration-300 group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-[var(--gp-gold)]" />
      </div>
      <h3 className="mt-5 font-display text-xl font-semibold">{t(tool.title)}</h3>
      <p className="mt-2 flex-1 text-pretty text-sm leading-relaxed text-mist">{t(tool.description)}</p>
      <div className="mt-5 flex flex-wrap gap-2">
        {tool.tags.map((tag) => {
          const label = typeof tag === 'string' ? t(tag) : tag.raw
          return (
            <span key={label} className="gp-chip">
              {label}
            </span>
          )
        })}
      </div>
    </Link>
  )
}
