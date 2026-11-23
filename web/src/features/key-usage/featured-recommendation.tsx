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
import { BookOpen, Download, Info } from 'lucide-react'
import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { CopyButton } from '@/components/copy-button'
import { Dialog } from '@/components/dialog'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button, buttonVariants } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'

const NDT_ICON_URL = '/ndt-icon.png'
const NDT_DOWNLOAD_URL = '/downloads/modern-translator-v1.0.0.zip'
const NDT_ARCHIVE_NAME = 'modern-translator-v1.0.0.zip'

function BrowserInstallSteps(props: { browser: 'chrome' | 'edge' }) {
  const { t } = useTranslation()
  const isChrome = props.browser === 'chrome'
  const extensionsUrl = isChrome ? 'chrome://extensions/' : 'edge://extensions/'

  return (
    <ol className='space-y-3 text-sm leading-relaxed'>
      <li className='bg-muted/45 flex items-start gap-3 rounded-xl border px-3.5 py-2.5'>
        <span className='bg-primary text-primary-foreground mt-0.5 grid size-5 shrink-0 place-items-center rounded-full text-xs font-semibold'>
          1
        </span>
        <p>
          {t(
            'Download {{filename}} and extract it into a permanent folder (make sure manifest.json is directly inside that folder).',
            { filename: NDT_ARCHIVE_NAME }
          )}
        </p>
      </li>
      <li className='bg-muted/45 flex items-start gap-3 rounded-xl border px-3.5 py-2.5'>
        <span className='bg-primary text-primary-foreground mt-0.5 grid size-5 shrink-0 place-items-center rounded-full text-xs font-semibold'>
          2
        </span>
        <div className='min-w-0 flex-1 space-y-1.5'>
          <p>
            {isChrome
              ? t('Open the Chrome extensions page in your address bar:')
              : t(
                  'Open the Microsoft Edge extensions page in your address bar:'
                )}
          </p>
          <div className='flex flex-wrap items-center gap-2'>
            <code className='bg-background rounded-md border px-2 py-1 font-mono text-xs select-all'>
              {extensionsUrl}
            </code>
            <CopyButton
              value={extensionsUrl}
              variant='outline'
              size='sm'
              aria-label={
                isChrome
                  ? t('Copy Chrome extensions URL')
                  : t('Copy Edge extensions URL')
              }
            >
              {t('Copy')}
            </CopyButton>
          </div>
        </div>
      </li>
      <li className='bg-muted/45 flex items-start gap-3 rounded-xl border px-3.5 py-2.5'>
        <span className='bg-primary text-primary-foreground mt-0.5 grid size-5 shrink-0 place-items-center rounded-full text-xs font-semibold'>
          3
        </span>
        <p>
          {isChrome
            ? t('Enable "Developer mode" in the top-right corner of the page.')
            : t('Enable "Developer mode" on the extensions page.')}
        </p>
      </li>
      <li className='bg-muted/45 flex items-start gap-3 rounded-xl border px-3.5 py-2.5'>
        <span className='bg-primary text-primary-foreground mt-0.5 grid size-5 shrink-0 place-items-center rounded-full text-xs font-semibold'>
          4
        </span>
        <p>
          {t(
            'Click "Load unpacked" and select the extracted folder to finish installing.'
          )}
        </p>
      </li>
    </ol>
  )
}

export function FeaturedRecommendation(props: { className?: string }) {
  const { t } = useTranslation()
  const titleId = useId()
  const [guideOpen, setGuideOpen] = useState(false)

  return (
    <>
      <Card
        role='region'
        aria-labelledby={titleId}
        className={cn(
          'border-border/70 justify-between rounded-3xl py-6',
          props.className
        )}
      >
        <CardHeader className='gap-3 px-6 sm:px-8'>
          <p
            id={titleId}
            className='text-muted-foreground text-xs font-medium tracking-wide'
          >
            {t('Featured recommendation')}
          </p>
          <div className='flex items-center gap-3.5'>
            <img
              src={NDT_ICON_URL}
              alt=''
              aria-hidden='true'
              width={44}
              height={44}
              className='border-border/60 size-11 shrink-0 rounded-xl border shadow-xs'
            />
            <div className='min-w-0'>
              <div className='flex flex-wrap items-center gap-2'>
                <CardTitle className='text-xl font-semibold sm:text-2xl'>
                  {t('Modern Translator')}
                </CardTitle>
                <Badge variant='secondary' className='font-mono text-[11px]'>
                  v1.0.0
                </Badge>
              </div>
              <p className='text-muted-foreground text-xs'>
                {t('Free · Open Source · No Ads')}
              </p>
            </div>
          </div>
          <CardDescription className='text-sm leading-relaxed'>
            {t(
              'Free, non-profit selection & full-page translator extension with bilingual view, streaming LLM batching, Microsoft/Google Translate, and custom OpenAI-compatible APIs.'
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className='flex flex-wrap items-center gap-3 px-6 sm:px-8'>
          <a
            href={NDT_DOWNLOAD_URL}
            download={NDT_ARCHIVE_NAME}
            className={buttonVariants({ variant: 'default' })}
          >
            <Download className='size-4' aria-hidden='true' />
            {t('Download extension (.zip)')}
          </a>
          <Button
            type='button'
            variant='link'
            className='px-1.5'
            onClick={() => setGuideOpen(true)}
          >
            <BookOpen className='size-4' aria-hidden='true' />
            {t('Installation guide')}
          </Button>
        </CardContent>
      </Card>

      <Dialog
        open={guideOpen}
        onOpenChange={setGuideOpen}
        title={t('Install Modern Translator')}
        description={t(
          'Load the downloaded extension package into Chrome or Microsoft Edge in a few steps.'
        )}
        contentClassName='sm:max-w-xl'
        footer={
          <>
            <a
              href={NDT_DOWNLOAD_URL}
              download={NDT_ARCHIVE_NAME}
              className={buttonVariants({ variant: 'outline' })}
            >
              <Download className='size-4' aria-hidden='true' />
              {t('Download extension (.zip)')}
            </a>
            <Button type='button' onClick={() => setGuideOpen(false)}>
              {t('Close')}
            </Button>
          </>
        }
      >
        <Tabs defaultValue='chrome' className='gap-4'>
          <TabsList>
            <TabsTrigger value='chrome'>Chrome</TabsTrigger>
            <TabsTrigger value='edge'>Microsoft Edge</TabsTrigger>
          </TabsList>
          <TabsContent value='chrome'>
            <BrowserInstallSteps browser='chrome' />
          </TabsContent>
          <TabsContent value='edge'>
            <BrowserInstallSteps browser='edge' />
          </TabsContent>
        </Tabs>
        <Alert className='mt-4'>
          <Info className='size-4' aria-hidden='true' />
          <AlertDescription>
            {t(
              'Keep the extracted folder on disk after installation; deleting or moving it will disable the extension. Once installed, you can pin the icon to your toolbar and use the built-in free translation service or your own API Key.'
            )}
          </AlertDescription>
        </Alert>
      </Dialog>
    </>
  )
}
