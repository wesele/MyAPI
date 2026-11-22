/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program.  If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import { Link } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { LanguageSwitcher } from '@/components/language-switcher'
import { SystemBrand } from '@/components/layout/components/system-brand'
import { buttonVariants } from '@/components/ui/button'

export function SharedPortalLayout(props: {
  children: ReactNode
  wide?: boolean
}) {
  const { t } = useTranslation()
  return (
    <div className='bg-muted/40 min-h-svh'>
      <header className='bg-background flex min-h-14 items-center justify-between gap-3 border-b px-4 sm:px-8'>
        <SystemBrand variant='inline' homeLink='/' />
        <div className='flex shrink-0 items-center gap-1 sm:gap-2'>
          <nav
            aria-label={t('Navigation')}
            className='flex shrink-0 items-center gap-1'
          >
            <Link
              to='/'
              activeOptions={{ exact: true }}
              className={buttonVariants({ variant: 'ghost' })}
            >
              {t('Home')}
            </Link>
            <Link
              to='/catalog'
              className={buttonVariants({ variant: 'ghost' })}
            >
              {t('Models')}
            </Link>
          </nav>
          <LanguageSwitcher />
        </div>
      </header>
      <main
        className={`mx-auto w-full px-4 pt-4 pb-10 sm:px-6 sm:pt-5 sm:pb-12 ${props.wide ? 'max-w-6xl' : 'max-w-2xl'}`}
      >
        {props.children}
      </main>
    </div>
  )
}
