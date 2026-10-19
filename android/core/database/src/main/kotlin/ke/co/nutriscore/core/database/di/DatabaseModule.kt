package ke.co.nutriscore.core.database.di

import android.content.Context
import androidx.room.Room
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import ke.co.nutriscore.core.database.NutriScoreDatabase
import ke.co.nutriscore.core.database.dao.CartDao
import javax.inject.Singleton

@Module
@InstallIn(SingletonComponent::class)
object DatabaseModule {

    @Provides
    @Singleton
    fun provideDatabase(
        @ApplicationContext context: Context
    ): NutriScoreDatabase {
        return Room.databaseBuilder(
            context,
            NutriScoreDatabase::class.java,
            NutriScoreDatabase.DATABASE_NAME
        )
        .fallbackToDestructiveMigration()
        .build()
    }

    @Provides
    @Singleton
    fun provideCartDao(database: NutriScoreDatabase): CartDao {
        return database.cartDao()
    }
}
