import { describe, expect, it } from 'vitest'
import { appHarness } from '../testing/appHarness'

describe('the tags of the user', () => {
  it('are in the store once they are read', async () => {
    const t = await appHarness()
    expect(t.store.state.tags).toEqual([])
    await t.app.tags.create('Work')
    expect(t.store.state.tags.map((tag) => tag.name)).toEqual(['Work'])
    await t.app.tags.load()
    expect(t.store.state.tags.map((tag) => tag.name)).toEqual(['Work'])
  })

  it('are read when the application starts', async () => {
    const t = await appHarness()
    await t.app.tags.create('Trips')
    t.store.setTags([])
    await t.app.start()
    expect(t.store.state.tags.map((tag) => tag.name)).toEqual(['Trips'])
  })

  it('get a tag that is made, which is given back with its keyword and colour', async () => {
    const t = await appHarness()
    const made = await t.app.tags.create('Für später', '#b03d33')
    expect(made).toMatchObject({ name: 'Für später', keyword: 'Fuer_spaeter', color: '#b03d33' })
  })

  it('make none from a name that is nothing, and one only from a name that comes to a keyword there is', async () => {
    const t = await appHarness()
    expect(await t.app.tags.create('  ')).toBeUndefined()
    const first = await t.app.tags.create('Work')
    expect(await t.app.tags.create('work')).toEqual(first)
    expect(t.store.state.tags).toHaveLength(1)
  })

  it('are shown on a screen of their own', async () => {
    const t = await appHarness()
    t.app.tags.show()
    expect(t.store.screen).toEqual({ name: 'tags' })
  })

  it('are renamed and recoloured, and the store has the change at once', async () => {
    const t = await appHarness()
    const made = (await t.app.tags.create('Work'))!
    expect(await t.app.tags.update(made.id, 'Arbeit', '#2a7a4f')).toBe(true)
    expect(t.store.state.tags).toEqual([{ ...made, name: 'Arbeit', color: '#2a7a4f' }])
  })

  it('are not renamed to nothing', async () => {
    const t = await appHarness()
    const made = (await t.app.tags.create('Work'))!
    expect(await t.app.tags.update(made.id, ' ', '#2a7a4f')).toBe(false)
    expect(t.store.state.tags).toEqual([made])
  })

  it('are forgotten, and the store has it at once', async () => {
    const t = await appHarness()
    const made = (await t.app.tags.create('Work'))!
    await t.app.tags.create('Trips')
    await t.app.tags.remove(made.id)
    expect(t.store.state.tags.map((tag) => tag.name)).toEqual(['Trips'])
  })
})
