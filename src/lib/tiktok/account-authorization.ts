export interface TikTokAccountOwnership {
    user_id: string;
    account_type: string;
}

export function isNormalTikTokAccountOwnedBy(
    account: TikTokAccountOwnership | null | undefined,
    expectedUserId: string | null | undefined
) {
    return Boolean(
        account
        && expectedUserId
        && account.account_type === 'normal'
        && account.user_id === expectedUserId
    );
}
