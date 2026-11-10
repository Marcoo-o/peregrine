import { describe, expect, it } from 'vitest'
import { addItem, addTask, deferTask, findTaskMessage, pruneFinished, removeTask, ruleFor, setItemDone, setTaskDone, tasksForDay, tomorrow } from './tasks'
import type { TasksState } from './app/screens'
import { appHarness } from './testing/appHarness'
import { migratedDatabase } from './testing/testDb'

// A Monday.
const MONDAY = '2026-11-02'
const TUESDAY = '2026-11-03'
const SATURDAY = '2026-11-07'

describe('the rule of a task', () => {
  it('is made from the day the task starts on', () => {
    expect(ruleFor('once', MONDAY)).toBe('once')
    expect(ruleFor('daily', MONDAY)).toBe('daily')
    expect(ruleFor('weekdays', MONDAY)).toBe('weekdays')
    expect(ruleFor('weekly', MONDAY)).toBe('weekly:1')
    expect(ruleFor('monthly', MONDAY)).toBe('monthly:2')
  })

  it('gives the day after', () => {
    expect(tomorrow(new Date(2026, 10, 30))).toBe('2026-12-01')
  })
})

describe('the tasks of a day', () => {
  it('are those whose rule covers it, in the order they were put in', async () => {
    const { db } = await migratedDatabase()
    await addTask(db, { title: 'Once' }, MONDAY)
    await addTask(db, { title: 'Every day', recurrence: 'daily' }, MONDAY)
    await addTask(db, { title: 'Workdays', recurrence: 'weekdays' }, MONDAY)
    expect((await tasksForDay(db, MONDAY)).map((task) => task.title)).toEqual(['Once', 'Every day', 'Workdays'])
    expect((await tasksForDay(db, TUESDAY)).map((task) => task.title)).toEqual(['Every day', 'Workdays'])
    expect((await tasksForDay(db, SATURDAY)).map((task) => task.title)).toEqual(['Every day'])
  })

  it('are not kept without a title, and a title is made one line', async () => {
    const { db } = await migratedDatabase()
    expect(await addTask(db, { title: '   ' }, MONDAY)).toEqual({ problem: 'empty' })
    await addTask(db, { title: '  Call  \n  Sam ' }, MONDAY)
    expect((await tasksForDay(db, MONDAY))[0].title).toBe('Call Sam')
  })

  it('are finished for a day, and a repeating one is open again the next', async () => {
    const { db } = await migratedDatabase()
    const made = await addTask(db, { title: 'Water', recurrence: 'daily' }, MONDAY)
    if ('problem' in made) throw new Error('not made')
    await setTaskDone(db, made.id, MONDAY, true)
    expect((await tasksForDay(db, MONDAY))[0].done).toBe(true)
    expect((await tasksForDay(db, TUESDAY))[0].done).toBe(false)
    await setTaskDone(db, made.id, MONDAY, false)
    expect((await tasksForDay(db, MONDAY))[0].done).toBe(false)
  })

  it('have a checklist whose ticks belong to a day', async () => {
    const { db } = await migratedDatabase()
    const made = await addTask(db, { title: 'Shop', recurrence: 'daily', items: ['Milk', ' ', 'Bread'] }, MONDAY)
    if ('problem' in made) throw new Error('not made')
    expect(await addItem(db, made.id, '  Eggs ')).toBe(true)
    expect(await addItem(db, made.id, '  ')).toBe(false)
    const [task] = await tasksForDay(db, MONDAY)
    expect(task.items.map((item) => item.title)).toEqual(['Milk', 'Bread', 'Eggs'])
    await setItemDone(db, task.items[0].id, MONDAY)
    const ticked = (await tasksForDay(db, MONDAY))[0].items[0]
    expect(ticked.doneOn).toBe(MONDAY)
    // The tick is a day: on the next the item is open by the date alone.
    expect(ticked.doneOn === TUESDAY).toBe(false)
  })
})

describe('moving a task and taking it away', () => {
  it('moves one that happens once to another day, open again, and not one that repeats', async () => {
    const { db } = await migratedDatabase()
    const once = await addTask(db, { title: 'Once', items: ['a'] }, MONDAY)
    const daily = await addTask(db, { title: 'Daily', recurrence: 'daily' }, MONDAY)
    if ('problem' in once || 'problem' in daily) throw new Error('not made')
    await setTaskDone(db, once.id, MONDAY, true)
    await setItemDone(db, (await tasksForDay(db, MONDAY))[0].items[0].id, MONDAY)
    expect(await deferTask(db, once.id, TUESDAY)).toBe(true)
    expect(await deferTask(db, daily.id, TUESDAY)).toBe(false)
    expect(await deferTask(db, 'nothing', TUESDAY)).toBe(false)
    const [moved] = (await tasksForDay(db, TUESDAY)).filter((task) => task.id === once.id)
    expect(moved).toMatchObject({ done: false })
    expect(moved.items[0].doneOn).toBeNull()
    expect((await tasksForDay(db, MONDAY)).map((task) => task.title)).toEqual(['Daily'])
  })

  it('takes a task away with its checklist and its days', async () => {
    const { db } = await migratedDatabase()
    const made = await addTask(db, { title: 'x', items: ['a'] }, MONDAY)
    if ('problem' in made) throw new Error('not made')
    await setTaskDone(db, made.id, MONDAY, true)
    await removeTask(db, made.id)
    expect(await db.all('SELECT * FROM tasks')).toEqual([])
    expect(await db.all('SELECT * FROM task_items')).toEqual([])
    expect(await db.all('SELECT * FROM task_completions')).toEqual([])
  })

  it('takes the finished ones that happen once when their day is over, and nothing else', async () => {
    const { db } = await migratedDatabase()
    const done = await addTask(db, { title: 'done' }, MONDAY)
    await addTask(db, { title: 'open' }, MONDAY)
    const repeats = await addTask(db, { title: 'repeats', recurrence: 'daily' }, MONDAY)
    if ('problem' in done || 'problem' in repeats) throw new Error('not made')
    await setTaskDone(db, done.id, MONDAY, true)
    await setTaskDone(db, repeats.id, MONDAY, true)
    expect(await pruneFinished(db, MONDAY)).toBe(0)
    expect(await pruneFinished(db, TUESDAY)).toBe(1)
    // The one that was not finished is kept (it is on its own day's list, as on the desktop); the finished one is gone.
    expect((await db.all<{ title: string }>('SELECT title FROM tasks ORDER BY title')).map((row) => row.title)).toEqual(['open', 'repeats'])
    expect((await tasksForDay(db, MONDAY)).map((task) => task.title)).toEqual(['open', 'repeats'])
  })
})

describe('the message of a task', () => {
  it('is found where it was put, and by its Message-ID when it was moved, and not when it is gone', async () => {
    const t = await appHarness()
    const work = await t.givenAccount('work', { INBOX: [{ uid: 1, subject: 'Hello', messageId: '<m1@example.net>' }], Archive: [] })
    const folders = await t.db.all<{ id: string; imap_path: string }>('SELECT id, imap_path FROM folders WHERE account_id = ?', work.id)
    const inbox = folders.find((f) => f.imap_path === 'INBOX')!.id
    const archive = folders.find((f) => f.imap_path === 'Archive')!.id
    const link = { accountId: work.id, folderId: inbox, uid: 1, messageId: '<m1@example.net>' }
    expect(await findTaskMessage(t.db, link)).toEqual({ accountId: work.id, folderId: inbox, uid: 1 })
    await t.db.run('UPDATE messages SET folder_id = ?, uid = ? WHERE folder_id = ? AND uid = ?', archive, 7, inbox, 1)
    expect(await findTaskMessage(t.db, link)).toEqual({ accountId: work.id, folderId: archive, uid: 7 })
    expect(await findTaskMessage(t.db, { ...link, messageId: null })).toBeNull()
    await t.db.run('DELETE FROM messages')
    expect(await findTaskMessage(t.db, link)).toBeNull()
  })
})

describe('the screen for the daily list', () => {
  it('shows today, adds, ticks, moves and removes, and says what it did', async () => {
    const t = await appHarness()
    await t.givenAccount('work', { INBOX: [] })
    await t.app.tasks.show()
    const shown = () => t.store.screen as TasksState
    expect(shown()).toMatchObject({ name: 'tasks', tasks: [] })
    await t.app.tasks.add('', 'once')
    expect(shown().error).toContain('Titel')
    await t.app.tasks.add('Call Sam', 'daily', [])
    expect(shown()).toMatchObject({ notice: 'Gespeichert.', tasks: [{ title: 'Call Sam', done: false }] })
    const id = shown().tasks[0].id
    await t.app.tasks.setDone(id, true)
    expect(shown().tasks[0].done).toBe(true)
    await t.app.tasks.defer(id)
    expect(shown().error).toContain('wiederholt')
    await t.app.tasks.add('Once', 'once')
    const once = shown().tasks.find((task) => task.title === 'Once')!
    await t.app.tasks.addItem(once.id, 'Step')
    expect(shown().tasks.find((task) => task.id === once.id)!.items).toHaveLength(1)
    await t.app.tasks.defer(once.id)
    expect(shown().notice).toContain('morgen')
    expect(shown().tasks.map((task) => task.title)).toEqual(['Call Sam'])
    await t.app.tasks.remove(id)
    expect(shown().tasks).toEqual([])
  })

  it('puts the open message on the list, and opens it again from there, or says it is gone', async () => {
    const t = await appHarness()
    const work = await t.givenAccount('work', { INBOX: [{ uid: 1, subject: 'Plan', messageId: '<p@example.net>' }] })
    const inbox = (await t.db.all<{ id: string }>("SELECT id FROM folders WHERE imap_path = 'INBOX'"))[0].id
    const said = await t.app.tasks.addMessage({ accountId: work.id, folderId: inbox, uid: 1, messageId: '<p@example.net>' }, 'Plan')
    expect(said).toContain('heute')
    await t.app.tasks.show()
    const [task] = (t.store.screen as TasksState).tasks
    expect(task).toMatchObject({ title: 'Plan', link: { uid: 1 } })
    await t.app.tasks.openMessage(task.link!)
    expect(t.store.screen).toMatchObject({ name: 'message', summary: { uid: 1 } })
    await t.db.run('DELETE FROM messages')
    await t.app.tasks.show()
    await t.app.tasks.openMessage(task.link!)
    expect((t.store.screen as TasksState).error).toContain('gibt es nicht mehr')
  })
})
