declare global {
  namespace App {
    interface Locals {
      session?: { user: { email: string } }
    }
  }
}

export {}
