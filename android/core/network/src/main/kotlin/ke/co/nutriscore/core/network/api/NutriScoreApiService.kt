package ke.co.nutriscore.core.network.api

import ke.co.nutriscore.core.network.model.LivePriceResponse
import ke.co.nutriscore.core.network.model.NetworkProduct
import retrofit2.http.GET
import retrofit2.http.Path
import retrofit2.http.Query

interface NutriScoreApiService {

    @GET("api/v1/products/search")
    suspend fun searchProducts(
        @Query("query") query: String,
        @Query("retailer") retailer: String? = null,
        @Query("category") category: String? = null,
        @Query("limit") limit: Int = 50
    ): List<NetworkProduct>

    @GET("api/v1/products/{id}")
    suspend fun getProductById(
        @Path("id") productId: String,
        @Query("retailer") retailer: String
    ): NetworkProduct

    @GET("api/v1/products/{id}/price")
    suspend fun getLivePrice(
        @Path("id") productId: String,
        @Query("retailer") retailer: String
    ): LivePriceResponse
}
