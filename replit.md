# Overview

This is a Point of Sale (POS) system built for tech and home appliance retail stores. The application features a modern React frontend with a Node.js/Express backend, designed to handle product management, customer transactions, inventory tracking, and sales reporting. The system supports both Arabic and French languages, includes barcode scanning capabilities, and provides comprehensive business management tools for retail operations.

# User Preferences

Preferred communication style: Simple, everyday language.

# System Architecture

## Frontend Architecture
- **Framework**: React with TypeScript using Vite as the build tool
- **UI Components**: Shadcn/ui component library built on Radix UI primitives
- **Styling**: Tailwind CSS with custom design tokens and dark mode support
- **State Management**: TanStack React Query for server state management
- **Routing**: Wouter for lightweight client-side routing
- **Forms**: React Hook Form with Zod validation for type-safe form handling

The frontend follows a modular component architecture with clear separation between pages, reusable UI components, and business logic components. Components are organized by feature (products, clients, POS, etc.) with shared UI components in a dedicated directory.

## Backend Architecture
- **Runtime**: Node.js with Express.js web framework
- **Language**: TypeScript with ES modules
- **Database ORM**: Drizzle ORM for type-safe database operations
- **API Design**: RESTful API structure with structured error handling
- **Development**: Hot-reload development server with Vite integration

The backend implements a layered architecture with clear separation between routes, business logic (storage layer), and external services. The storage interface provides a clean abstraction over database operations.

## Database Design
- **Primary Database**: PostgreSQL with Neon serverless hosting
- **Schema Management**: Drizzle migrations with shared schema definitions
- **Key Entities**: Users, Products, Categories, Brands, Clients, Invoices, Shifts, Cash Transactions
- **Relationships**: Proper foreign key relationships between entities with support for product categorization and invoice line items

The database supports multi-language product names (Arabic/French), inventory tracking with low-stock alerts, and comprehensive transaction history.

## Authentication & Session Management
- **Password Security**: bcryptjs for password hashing
- **Session Storage**: PostgreSQL-backed sessions using connect-pg-simple
- **User Roles**: Role-based access control with different permission levels

## Real-time Features
- **Barcode Scanning**: Browser-based camera integration with QuaggaJS library
- **Offline Support**: IndexedDB for local data caching and offline transaction queuing
- **Network Status**: Automatic online/offline detection with sync capabilities

## External Service Integrations
- **AI Services**: OpenAI GPT-5 integration for intelligent product categorization suggestions
- **PDF Generation**: Invoice PDF generation capabilities (framework ready)
- **Payment Processing**: Multi-payment method support (cash, card, mobile payments)

# External Dependencies

## Core Framework Dependencies
- **Neon Database**: Serverless PostgreSQL hosting (@neondatabase/serverless)
- **Drizzle ORM**: Type-safe database operations (drizzle-orm, drizzle-kit)
- **React Ecosystem**: React 18 with TypeScript, TanStack React Query for data fetching
- **Vite**: Build tool and development server with hot-reload support

## UI and Styling
- **Shadcn/ui**: Complete component library based on Radix UI primitives
- **Tailwind CSS**: Utility-first CSS framework with custom design system
- **Radix UI**: Headless UI primitives for accessibility and customization

## Business Logic Libraries
- **OpenAI**: AI-powered product categorization and business intelligence
- **bcryptjs**: Secure password hashing for user authentication
- **Zod**: Runtime type validation for forms and API endpoints
- **date-fns**: Date manipulation and formatting with internationalization

## Hardware Integration
- **QuaggaJS**: Browser-based barcode scanning using device cameras
- **MediaDevices API**: Camera access for barcode scanning functionality

## Development Tools
- **TypeScript**: Static typing across the entire stack
- **ESLint/Prettier**: Code quality and formatting (configuration ready)
- **Replit Integration**: Development environment plugins for cartographer and dev banner

The system is designed to be scalable and maintainable with clear separation of concerns, comprehensive error handling, and support for both online and offline operations.