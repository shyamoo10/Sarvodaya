import type { Address, ProjectSite, User } from '@prisma/client';

export function serializeUser(user: User) {
  return {
    id: user.id,
    phone: user.phone,
    name: user.name,
    accountType: user.accountType,
    companyName: user.companyName,
    gstNumber: user.gstNumber,
    isBlocked: user.isBlocked,
    lastLoginAt: user.lastLoginAt ? user.lastLoginAt.toISOString() : null,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
  };
}

export function serializeAdminUser(user: User) {
  return {
    ...serializeUser(user),
    blockedAt: user.blockedAt ? user.blockedAt.toISOString() : null,
    blockedReason: user.blockedReason,
  };
}

export function serializeAddress(address: Address) {
  return {
    id: address.id,
    label: address.label,
    contactName: address.contactName,
    contactPhone: address.contactPhone,
    line1: address.line1,
    line2: address.line2,
    landmark: address.landmark,
    city: address.city,
    state: address.state,
    pincode: address.pincode,
    latitude: address.latitude,
    longitude: address.longitude,
    isDefault: address.isDefault,
    createdAt: address.createdAt.toISOString(),
    updatedAt: address.updatedAt.toISOString(),
  };
}

export function serializeProjectSite(site: ProjectSite) {
  return {
    id: site.id,
    siteName: site.siteName,
    contactName: site.contactName,
    contactPhone: site.contactPhone,
    line1: site.line1,
    line2: site.line2,
    landmark: site.landmark,
    city: site.city,
    state: site.state,
    pincode: site.pincode,
    latitude: site.latitude,
    longitude: site.longitude,
    notes: site.notes,
    createdAt: site.createdAt.toISOString(),
    updatedAt: site.updatedAt.toISOString(),
  };
}
