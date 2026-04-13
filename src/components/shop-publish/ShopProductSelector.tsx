'use client'

// Shop Product Selector — showcase product picker
// Pattern: grid cards with single-select mode
// Data source: GET /api/shop-publish/products?account_id=xxx

import { useState, useEffect, useCallback, useMemo } from 'react'
import {
    Search,
    Loader2,
    ShoppingBag,
    Check,
    ChevronRight,
    RefreshCw,
    AlertCircle,
    ImageOff,
} from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { useLang } from '@/contexts/LangContext'
import SHOP_TEXT, { localizeError } from './shop-publish.i18n'

// ============================================================
// Types (aligned with ShopProduct from shop-types.ts)
// ============================================================

interface ProductImage {
    url: string
    width: number
    height: number
}

interface Product {
    id: string
    shop: {
        name: string
    }
    addition: {
        customized_main_images: ProductImage[]
    }
    price: {
        original_price: {
            minimum_amount: string
            maximum_amount: string
        }
    }
    commission_rate?: number
    status: string
}

interface ShopProductSelectorProps {
    accountId: string
    selectedProductId?: string
    onSelect: (product: Product | null) => void
}

// ============================================================
// Component
// ============================================================

export function ShopProductSelector({
    accountId,
    selectedProductId,
    onSelect,
}: ShopProductSelectorProps) {
    const { lang } = useLang()
    const T = SHOP_TEXT.product

    const [products, setProducts] = useState<Product[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [searchQuery, setSearchQuery] = useState('')
    const [nextPageToken, setNextPageToken] = useState<string | null>(null)
    const [loadingMore, setLoadingMore] = useState(false)
    const [hasMore, setHasMore] = useState(false)

    // ============================================================
    // Data Fetching
    // ============================================================

    const fetchProducts = useCallback(async (pageToken?: string) => {
        if (!accountId) return

        const isLoadMore = !!pageToken
        if (isLoadMore) {
            setLoadingMore(true)
        } else {
            setLoading(true)
            setError(null)
        }

        try {
            const params = new URLSearchParams({
                account_id: accountId,
                page_size: '20',
            })
            if (pageToken) {
                params.set('page_token', pageToken)
            }

            const res = await fetch(`/api/shop-publish/products?${params}`)

            if (!res.ok) {
                const data = await res.json()
                throw new Error(data.error || 'Failed to load products')
            }

            const data = await res.json()
            const newProducts: Product[] = data.products || []

            if (isLoadMore) {
                setProducts(prev => [...prev, ...newProducts])
            } else {
                setProducts(newProducts)
            }

            // Pagination
            setNextPageToken(data.next_page_token || null)
            setHasMore(!!data.next_page_token)
        } catch (err) {
            console.error('Failed to fetch showcase products:', err)
            setError(err instanceof Error ? localizeError(err.message, lang) : localizeError('Failed to load products', lang))
        } finally {
            setLoading(false)
            setLoadingMore(false)
        }
    }, [accountId, lang])

    // Initial load when accountId changes
    useEffect(() => {
        setProducts([])
        setSearchQuery('')
        setNextPageToken(null)
        fetchProducts()
    }, [fetchProducts])

    // ============================================================
    // Filtering (client-side search)
    // ============================================================

    const filteredProducts = useMemo(() => {
        if (!searchQuery.trim()) return products
        const query = searchQuery.toLowerCase()
        return products.filter(p =>
            p.shop.name.toLowerCase().includes(query) ||
            p.id.toLowerCase().includes(query)
        )
    }, [products, searchQuery])

    // ============================================================
    // Handlers
    // ============================================================

    const handleSelect = (product: Product) => {
        if (selectedProductId === product.id) {
            onSelect(null) // Deselect
        } else {
            onSelect(product) // Select
        }
    }

    const handleLoadMore = () => {
        if (nextPageToken && !loadingMore) {
            fetchProducts(nextPageToken)
        }
    }

    // ============================================================
    // Price Formatting
    // ============================================================

    const formatPrice = (product: Product) => {
        const min = product.price.original_price.minimum_amount
        const max = product.price.original_price.maximum_amount
        if (min === max) {
            return `$${(parseInt(min) / 100).toFixed(2)}`
        }
        return `$${(parseInt(min) / 100).toFixed(2)} - $${(parseInt(max) / 100).toFixed(2)}`
    }

    const formatCommission = (rate?: number) => {
        if (!rate) return null
        return `${(rate * 100).toFixed(1)}%`
    }

    // ============================================================
    // Render
    // ============================================================

    // Loading state
    if (loading) {
        return (
            <div className="flex flex-col items-center justify-center py-16">
                <Loader2 className="w-8 h-8 animate-spin text-gray-400 mb-3" />
                <p className="text-sm text-gray-500">{T.loading[lang]}</p>
            </div>
        )
    }

    // Error state
    if (error) {
        return (
            <div className="flex flex-col items-center justify-center py-16">
                <div className="w-16 h-16 rounded-full bg-red-500/10 flex items-center justify-center mb-4">
                    <AlertCircle className="w-8 h-8 text-red-400" />
                </div>
                <p className="text-sm text-red-400 mb-4">{error}</p>
                <Button
                    variant="outline"
                    size="sm"
                    onClick={() => fetchProducts()}
                    className="gap-2"
                >
                    <RefreshCw className="w-4 h-4" />
                    {T.retry[lang]}
                </Button>
            </div>
        )
    }

    // Empty state
    if (products.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center py-16">
                <div className="w-16 h-16 rounded-full bg-gradient-to-br from-[#CCFF00]/20 via-[#00F2EA]/20 to-[#EC4899]/20 flex items-center justify-center mb-4 border border-white/10">
                    <ShoppingBag className="w-8 h-8 text-[#00F2EA]" />
                </div>
                <h3 className="text-lg font-semibold text-white mb-1">{T.noProducts[lang]}</h3>
                <p className="text-sm text-gray-500 text-center max-w-xs">
                    {T.noProductsDesc[lang]}
                </p>
            </div>
        )
    }

    return (
        <div className="space-y-4">
            {/* Search + Count */}
            <div className="flex items-center gap-3">
                <div className="relative flex-1">
                    <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-gray-500" />
                    <Input
                        placeholder={T.searchPlaceholder[lang]}
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="pl-9 h-9 bg-white/5 border-white/10"
                    />
                </div>
                <span className="text-xs text-gray-500 whitespace-nowrap">
                    {filteredProducts.length} {filteredProducts.length !== 1 ? T.productsCount[lang] : T.productCount[lang]}
                </span>
                <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => fetchProducts()}
                    className="text-gray-400 hover:text-white shrink-0"
                >
                    <RefreshCw className="w-4 h-4" />
                </Button>
            </div>

            {/* Selected Product Indicator */}
            {selectedProductId && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-cyan-500/10 border border-cyan-500/30">
                    <Check className="w-4 h-4 text-cyan-400" />
                    <span className="text-sm text-cyan-300">
                        {T.selected[lang]}
                    </span>
                </div>
            )}

            {/* Product Grid */}
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                {filteredProducts.map(product => {
                    const isSelected = selectedProductId === product.id
                    const mainImage = product.addition.customized_main_images?.[0]

                    return (
                        <div
                            key={product.id}
                            onClick={() => handleSelect(product)}
                            className={cn(
                                'relative rounded-xl border overflow-hidden cursor-pointer transition-all duration-200',
                                'hover:shadow-lg hover:scale-[1.02]',
                                isSelected
                                    ? 'border-cyan-500/70 bg-cyan-500/10 shadow-[0_0_15px_rgba(0,242,234,0.15)]'
                                    : 'border-white/10 bg-white/5 hover:border-white/20'
                            )}
                        >
                            {/* Product Image */}
                            <div className="aspect-square relative bg-white/5 overflow-hidden">
                                {mainImage?.url ? (
                                    <img
                                        src={mainImage.url}
                                        alt={product.shop.name}
                                        className="w-full h-full object-cover"
                                    />
                                ) : (
                                    <div className="w-full h-full flex items-center justify-center">
                                        <ImageOff className="w-8 h-8 text-gray-600" />
                                    </div>
                                )}

                                {/* Selected Overlay */}
                                {isSelected && (
                                    <div className="absolute inset-0 bg-cyan-500/20 flex items-center justify-center">
                                        <div className="w-10 h-10 rounded-full bg-cyan-500 flex items-center justify-center shadow-lg">
                                            <Check className="w-6 h-6 text-white" />
                                        </div>
                                    </div>
                                )}

                                {/* Commission Badge */}
                                {product.commission_rate && (
                                    <div className="absolute top-2 right-2">
                                        <Badge className="bg-gradient-to-r from-orange-500 to-pink-500 text-white text-[10px] px-1.5 py-0.5 border-0">
                                            {formatCommission(product.commission_rate)} {T.comm[lang]}
                                        </Badge>
                                    </div>
                                )}
                            </div>

                            {/* Product Info */}
                            <div className="p-3">
                                <p className="text-sm text-white font-medium line-clamp-2 mb-1.5 min-h-[2.5rem]">
                                    {product.shop.name}
                                </p>
                                <div className="flex items-center justify-between">
                                    <span className="text-sm font-bold text-[#CCFF00]">
                                        {formatPrice(product)}
                                    </span>
                                </div>
                            </div>
                        </div>
                    )
                })}
            </div>

            {/* Load More */}
            {hasMore && (
                <div className="flex justify-center pt-2">
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={handleLoadMore}
                        disabled={loadingMore}
                        className="gap-2 text-gray-400 hover:text-white"
                    >
                        {loadingMore ? (
                            <>
                                <Loader2 className="w-4 h-4 animate-spin" />
                                {T.loadingMore[lang]}
                            </>
                        ) : (
                            <>
                                {T.loadMore[lang]}
                                <ChevronRight className="w-4 h-4" />
                            </>
                        )}
                    </Button>
                </div>
            )}

            {/* No Results After Search */}
            {filteredProducts.length === 0 && searchQuery && (
                <div className="text-center py-8">
                    <p className="text-sm text-gray-500">
                        {T.noMatch[lang]} &ldquo;{searchQuery}&rdquo;
                    </p>
                </div>
            )}
        </div>
    )
}
