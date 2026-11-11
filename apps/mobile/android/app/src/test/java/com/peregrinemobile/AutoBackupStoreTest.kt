package com.peregrinemobile

import org.junit.Assert.assertEquals
import org.junit.Test

class AutoBackupStoreTest {
  private fun name(stamp: String) = "peregrine-backup-auto-$stamp.pgbk"

  @Test
  fun keepsTheNewestAutomaticBackupsAndNamesTheOthersForDeleting() {
    val names = listOf(name("2026-11-01_030000"), name("2026-11-08_030000"), name("2026-11-15_030000"), name("2026-11-22_030000"))
    assertEquals(listOf(name("2026-11-08_030000"), name("2026-11-01_030000")), backupsToDelete(names, 2))
  }

  @Test
  fun neverNamesAFileThatIsNotAnAutomaticBackup() {
    val names = listOf("holiday.jpg", "peregrine-backup-2026-11-10_2338.pgbk", name("2026-11-01_030000"), name("2026-11-08_030000"))
    assertEquals(listOf(name("2026-11-01_030000")), backupsToDelete(names, 1))
  }

  @Test
  fun keepsAtLeastOneWhateverTheNumberSaysSoThatTheNewestIsNeverDeleted() {
    val names = listOf(name("2026-11-01_030000"), name("2026-11-08_030000"))
    assertEquals(listOf(name("2026-11-01_030000")), backupsToDelete(names, 0))
    assertEquals(emptyList<String>(), backupsToDelete(emptyList(), 5))
  }
}
