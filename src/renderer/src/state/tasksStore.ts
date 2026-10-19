import { create } from 'zustand'
import type { DailyList, TaskInput } from '@peregrine/core/types'

interface TasksState {
  list: DailyList
  loaded: boolean
  load: () => Promise<void>
  create: (input: TaskInput) => Promise<void>
  setDone: (taskId: string, done: boolean) => Promise<void>
  setItemDone: (itemId: string, done: boolean) => Promise<void>
  addItem: (taskId: string, title: string) => Promise<void>
  deleteItem: (itemId: string) => Promise<void>
  remove: (taskId: string) => Promise<void>
  update: (taskId: string, patch: { title?: string; notes?: string; recurrence?: string }) => Promise<void>
  /** Moves a task to a position in the list and stores the new order. */
  reorder: (taskId: string, toIndex: number) => Promise<void>
  /** Pushes a one-off task to the next day; `moved` is false for a recurring one. */
  defer: (taskId: string) => Promise<{ moved: boolean; toDay: string }>
}

const empty: DailyList = { dayKey: '', tasks: [], mails: [] }

/**
 * Today's list.
 *
 * Every change re-reads the whole thing rather than patching the copy in memory. The list is
 * small, and what belongs on it is decided in the main process from rules and from the tags
 * on the server. Guessing the outcome here would mean writing that decision a second time,
 * in a place that cannot see the mail.
 */
export const useTasksStore = create<TasksState>((set, get) => ({
  list: empty,
  loaded: false,

  load: async () => {
    try {
      set({ list: await window.peregrine.tasks.today(), loaded: true })
    } catch (err) {
      console.error('reading the daily list failed:', err)
      set({ loaded: true })
    }
  },

  create: async (input) => {
    await window.peregrine.tasks.create(input)
    await get().load()
  },

  setDone: async (taskId, done) => {
    await window.peregrine.tasks.setDone({ taskId, done })
    await get().load()
  },

  setItemDone: async (itemId, done) => {
    await window.peregrine.tasks.setItemDone({ itemId, done })
    await get().load()
  },

  addItem: async (taskId, title) => {
    await window.peregrine.tasks.addItem({ taskId, title })
    await get().load()
  },

  deleteItem: async (itemId) => {
    await window.peregrine.tasks.deleteItem(itemId)
    await get().load()
  },

  remove: async (taskId) => {
    await window.peregrine.tasks.delete(taskId)
    await get().load()
  },

  update: async (taskId, patch) => {
    await window.peregrine.tasks.update({ taskId, ...patch })
    await get().load()
  },

  /**
   * Moves a task within the list.
   *
   * The new order is applied locally first and only then written. Dragging is a continuous
   * gesture; waiting for a round trip before the row moves makes the list feel like it is
   * resisting.
   */
  reorder: async (taskId, toIndex) => {
    const tasks = [...get().list.tasks]
    const from = tasks.findIndex((task) => task.id === taskId)
    if (from === -1 || from === toIndex) return

    const [moved] = tasks.splice(from, 1)
    tasks.splice(toIndex, 0, moved)
    set((state) => ({ list: { ...state.list, tasks } }))

    await window.peregrine.tasks.reorder({ taskIds: tasks.map((task) => task.id) })
    await get().load()
  },

  defer: async (taskId) => {
    const result = await window.peregrine.tasks.defer({ taskId })
    await get().load()
    return result
  }
}))
