package ke.co.nutriscore.core.database

import androidx.room.Database
import androidx.room.RoomDatabase
import ke.co.nutriscore.core.database.dao.CartDao
import ke.co.nutriscore.core.database.entity.CartItemEntity

@Database(
    entities = [CartItemEntity::class],
    version = 1,
    exportSchema = false
)
abstract class NutriScoreDatabase : RoomDatabase() {
    abstract fun cartDao(): CartDao

    companion object {
        const val DATABASE_NAME = "nutriscore_local.db"
    }
}
