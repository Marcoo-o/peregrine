import type { Recurrence } from '@peregrine/core/recurrence'
import { addItem, addTask, deferTask, findTaskMessage, pruneFinished, removeItem, removeTask, ruleFor, setItemDone, setTaskDone, tasksForDay, today, tomorrow, type TaskLink } from '../tasks'
import { t } from '../i18n'
import type { MessageController } from './MessageController'
import type { Services } from './services'
import type { AppStore } from './store'

/** The daily list: what is due today, added to, ticked, moved to tomorrow, taken away, and the message a task was made from opened. */
export class TasksController {
  constructor(
    private readonly services: Services,
    private readonly store: AppStore,
    private readonly messages: MessageController
  ) {}

  /** The list for a day (today when none is named), with a line about what was just done or what went wrong. */
  async show(day: string = today(), notice?: string, error?: string): Promise<void> {
    const { db } = this.services
    // What was finished on an earlier day and happens once is not wanted on the list any more.
    await pruneFinished(db, today())
    this.store.showScreen({ name: 'tasks', day, tasks: await tasksForDay(db, day), notice, error })
  }

  private day(): string {
    const shown = this.store.screen
    return shown.name === 'tasks' ? shown.day : today()
  }

  /** Adds a task that starts on the day shown, repeating as chosen. */
  async add(title: string, repeat: Recurrence['kind'], items: string[] = []): Promise<void> {
    const day = this.day()
    const made = await addTask(this.services.db, { title, recurrence: ruleFor(repeat, day), items }, day)
    if ('problem' in made) await this.show(day, undefined, t('Die Aufgabe braucht einen Titel.'))
    else await this.show(day, t('Gespeichert.'))
  }

  /** Adds the message to the list, for today, as a task that opens it. Returns what to say of it. */
  async addMessage(link: TaskLink, subject: string): Promise<string> {
    const made = await addTask(this.services.db, { title: subject.trim() || t('(ohne Betreff)'), link }, today())
    return 'problem' in made ? t('Die Aufgabe braucht einen Titel.') : t('Die Nachricht steht auf der Liste für heute.')
  }

  async setDone(id: string, done: boolean): Promise<void> {
    await setTaskDone(this.services.db, id, this.day(), done)
    await this.show(this.day())
  }

  async setItem(itemId: string, done: boolean): Promise<void> {
    await setItemDone(this.services.db, itemId, done ? this.day() : null)
    await this.show(this.day())
  }

  async addItem(taskId: string, title: string): Promise<void> {
    await addItem(this.services.db, taskId, title)
    await this.show(this.day())
  }

  async removeItem(itemId: string): Promise<void> {
    await removeItem(this.services.db, itemId)
    await this.show(this.day())
  }

  async remove(id: string): Promise<void> {
    await removeTask(this.services.db, id)
    await this.show(this.day(), t('Die Aufgabe ist entfernt.'))
  }

  /** Moves a task that happens once to the next day; says so for one that repeats, which the rule moves. */
  async defer(id: string): Promise<void> {
    const moved = await deferTask(this.services.db, id, tomorrow())
    await this.show(this.day(), moved ? t('Die Aufgabe ist auf morgen verschoben.') : undefined, moved ? undefined : t('Eine Aufgabe, die sich wiederholt, lässt sich nicht verschieben.'))
  }

  /** Opens the message a task was made from, wherever it is now; says so when it cannot be found. */
  async openMessage(link: TaskLink): Promise<void> {
    const found = await findTaskMessage(this.services.db, link)
    if (!found) {
      await this.show(this.day(), undefined, t('Die Nachricht dieser Aufgabe gibt es nicht mehr.'))
      return
    }
    await this.messages.openTarget(found)
  }
}
