import type { SqlDb } from '../db/sqlDb'
import type { IpcMain } from 'electron'
import { IpcChannels } from '@shared/ipcContracts'
import type { DailyList, MessageRef, TaskInput } from '@peregrine/core/types'
import { currentDayKey, fromDayKey, toDayKey } from '@peregrine/core/recurrence'
import { getAppSettings } from '../db/repositories/appSettingsRepo'
import {
  addTaskItem,
  createTask,
  deleteTask,
  deferTask,
  reorderTasks,
  deleteTaskItem,
  getTask,
  listTaggedMails,
  listTasksForDay,
  setTaskDone,
  resolveTaskMessage,
  setTaskItemDone,
  updateTask
} from '../db/repositories/tasksRepo'

export function registerTasksIpc(ipcMain: IpcMain, db: SqlDb): void {
  /** The day the list is for; the start hour decides, not midnight. */
  const today = async (): Promise<string> =>
    currentDayKey(new Date(), (await getAppSettings(db)).dayStartHour)

  ipcMain.handle(IpcChannels.tasksToday, async (): Promise<DailyList> => {
    const dayKey = await today()
    return {
      dayKey,
      tasks: await listTasksForDay(db, dayKey),
      mails: await listTaggedMails(db, (await getAppSettings(db)).dailyTagKeyword)
    }
  })

  ipcMain.handle(
    IpcChannels.tasksCreate,
    async (_event, input: TaskInput): Promise<{ taskId: string }> => {
      // Created for today, not for the day it was typed: a task added at one in the morning
      // belongs to the evening one is still having.
      return { taskId: await createTask(db, input, await today()) }
    }
  )

  ipcMain.handle(
    IpcChannels.tasksUpdate,
    async (
      _event,
      args: { taskId: string; title?: string; notes?: string; recurrence?: string }
    ): Promise<void> => {
      await updateTask(db, args.taskId, args)
    }
  )

  ipcMain.handle(
    IpcChannels.tasksReorder,
    async (_event, args: { taskIds: string[] }): Promise<void> => {
      await reorderTasks(db, args.taskIds)
    }
  )

  /**
   * Pushes a task to the next day.
   *
   * "Tomorrow" is counted from the list's own day, not from the wall clock: at one in the
   * morning the list still shows the previous day, and moving something on should land it on
   * the day after *that* rather than skipping one.
   */
  ipcMain.handle(
    IpcChannels.tasksDefer,
    async (_event, args: { taskId: string }): Promise<{ moved: boolean; toDay: string }> => {
      const from = fromDayKey(await today()) ?? new Date()
      const tomorrow = new Date(from)
      tomorrow.setDate(tomorrow.getDate() + 1)
      const toDay = toDayKey(tomorrow)
      return { moved: await deferTask(db, args.taskId, toDay), toDay }
    }
  )

  ipcMain.handle(
    IpcChannels.tasksDelete,
    async (_event, args: { taskId: string }): Promise<void> => {
      await deleteTask(db, args.taskId)
    }
  )

  ipcMain.handle(
    IpcChannels.tasksSetDone,
    async (_event, args: { taskId: string; done: boolean }): Promise<void> => {
      await setTaskDone(db, args.taskId, await today(), args.done)
    }
  )

  ipcMain.handle(
    IpcChannels.tasksAddItem,
    async (_event, args: { taskId: string; title: string }): Promise<{ itemId: string }> => {
      return { itemId: await addTaskItem(db, args.taskId, args.title) }
    }
  )

  ipcMain.handle(
    IpcChannels.tasksSetItemDone,
    async (_event, args: { itemId: string; done: boolean }): Promise<void> => {
      await setTaskItemDone(db, args.itemId, args.done ? await today() : null)
    }
  )

  ipcMain.handle(
    IpcChannels.tasksDeleteItem,
    async (_event, args: { itemId: string }): Promise<void> => {
      await deleteTaskItem(db, args.itemId)
    }
  )

  ipcMain.handle(
    IpcChannels.tasksResolveMessage,
    async (_event, args: { taskId: string }): Promise<MessageRef | null> => {
      const task = await getTask(db, args.taskId)
      return task?.link ? resolveTaskMessage(db, task.link) : null
    }
  )
}
