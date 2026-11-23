/**
 * Every page path in one place (GEN-14), so links, redirects and the route guard never drift apart.
 * Teammates add their pages here when they create them. Section ownership follows the Jira stories.
 */
export const ROUTES = {
  home: '/',
  login: '/login',
  register: '/register',
  sessionRefresh: '/session/refresh',

  flights: '/flights',
  hotels: '/hotels',
  itineraries: '/itineraries',
  blog: '/blog',

  account: '/account',
  changePassword: '/account/change-password',
  notifications: '/account/notifications',

  bookings: '/bookings',
  myItineraries: '/itineraries/mine',
  checkoutFlight: '/checkout/flight',
  checkoutHotel: '/checkout/hotel',

  admin: '/admin',
  airlineDashboard: '/moderator/airline',
  hotelDashboard: '/moderator/hotel',

  designSystem: '/design-system',
} as const;
