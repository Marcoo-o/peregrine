import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, Trash2 } from 'lucide-react'
import { TAG_COLORS } from '@peregrine/core/tags'
import { useTagsStore } from '@renderer/state/tagsStore'
import { toastError } from '@renderer/state/toastStore'

/**
 * Managing the tag definitions.
 *
 * The keyword a tag is stored under is shown but not editable: it is what every already
 * tagged message carries on the server, and changing it would orphan all of them.
 */
function TagsSection(): JSX.Element {
  const { t } = useTranslation()
  const { tags, load } = useTagsStore()
  const [name, setName] = useState('')
  const [color, setColor] = useState(TAG_COLORS[0])

  useEffect(() => {
    void load()
  }, [])

  async function handleCreate(): Promise<void> {
    if (name.trim() === '') return
    try {
      await window.peregrine.tags.create({ name: name.trim(), color })
      setName('')
      await load()
    } catch (err) {
      toastError(err, t('settings.tagCreateFailed'))
    }
  }

  return (
    <section className="settings-section">
      <h3>{t('settings.sections.tags')}</h3>
      <span className="settings-hint">{t('settings.tagsHint')}</span>

      <ul className="tag-settings-list">
        {tags.map((tag) => (
          <li key={tag.id} className="tag-settings-row">
            <input
              type="color"
              value={tag.color}
              onChange={async (e) => {
                await window.peregrine.tags.update({
                  tagId: tag.id,
                  name: tag.name,
                  color: e.target.value
                })
                await load()
              }}
            />
            <input
              className="tag-name-input"
              value={tag.name}
              onChange={() => undefined}
              onBlur={async (e) => {
                if (e.target.value.trim() === '' || e.target.value === tag.name) return
                await window.peregrine.tags.update({
                  tagId: tag.id,
                  name: e.target.value.trim(),
                  color: tag.color
                })
                await load()
              }}
              // Uncontrolled while typing: a rename only takes effect on blur, so every
              // keystroke does not become a database write and a server-visible change.
              defaultValue={tag.name}
              key={`${tag.id}-${tag.name}`}
            />
            <code className="tag-keyword" title={t('settings.tagKeywordHint')}>
              {tag.keyword}
            </code>
            <button
              className="icon-button"
              aria-label={t('settings.tagDelete')}
              title={t('settings.tagDelete')}
              onClick={async () => {
                if (!window.confirm(t('settings.confirmDeleteTag', { name: tag.name }))) return
                await window.peregrine.tags.delete(tag.id)
                await load()
              }}
            >
              <Trash2 size={14} strokeWidth={1.75} />
            </button>
          </li>
        ))}
      </ul>

      <div className="tag-create-row">
        <input type="color" value={color} onChange={(e) => setColor(e.target.value)} />
        <input
          placeholder={t('settings.tagName')}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void handleCreate()}
        />
        <button onClick={() => void handleCreate()} disabled={name.trim() === ''}>
          <Plus size={14} strokeWidth={1.75} />
          {t('settings.tagAdd')}
        </button>
      </div>
    </section>
  )
}

export default TagsSection
