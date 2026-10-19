package ke.co.nutriscore.core.database.dao

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import ke.co.nutriscore.core.database.entity.CartItemEntity
import kotlinx.coroutines.flow.Flow

@Dao
interface CartDao {

    @Query("SELECT * FROM cart_items ORDER BY added_at DESC")
    fun observeAllCartItems(): Flow<List<CartItemEntity>>

    @Query("SELECT * FROM cart_items WHERE id = :id LIMIT 1")
    suspend fun getCartItemById(id: String): CartItemEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertOrUpdate(item: CartItemEntity)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertAll(items: List<CartItemEntity>)

    @Query("UPDATE cart_items SET quantity = :quantity WHERE id = :id")
    suspend fun updateQuantity(id: String, quantity: Int)

    @Query("DELETE FROM cart_items WHERE id = :id")
    suspend fun deleteById(id: String)

    @Query("UPDATE cart_items SET price_kes = :newPrice WHERE product_id = :productId AND retailer = :retailer")
    suspend fun updateLivePrice(productId: String, retailer: String, newPrice: Double)

    @Query("SELECT COUNT(*) FROM cart_items")
    fun observeCartItemCount(): Flow<Int>

    @Query("DELETE FROM cart_items")
    suspend fun clearCart()
}
