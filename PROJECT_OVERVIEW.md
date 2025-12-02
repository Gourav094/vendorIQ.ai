Hi everyone,
I’m excited to introduce VendorIQ.ai, an open-source, AI-powered invoice automation platform designed specifically for small and mid-sized businesses.

Today, most SMBs still manually process vendor invoices—downloading PDFs, extracting totals, checking due dates, validating vendor info, and uploading everything into their accounting or ERP system. This leads to wasted time, inconsistent data entry, delayed payments, and avoidable financial errors.

VendorIQ.ai solves this by providing a fully automated, event-driven invoice processing workflow using a microservices architecture.

Our system is built using five independent microservices, each responsible for a dedicated domain—OCR extraction, vendor email ingestion, document storage, authentication, and the AI decision engine.
All of these services are orchestrated through an API Gateway, designed strictly following REST API design guidelines, making the system consistent, scalable, and easy to contribute to.

To ensure reliability across distributed services, VendorIQ.ai uses the Saga pattern with a Kafka-based event-driven pipeline. When an invoice arrives—typically through email—Kafka handles the communication between the Email Service and the OCR Service. This ensures data consistency, fault tolerance, and guaranteed processing even when one service is temporarily down.

The entire platform is containerized into separate Docker images so contributors don’t need to install dependencies manually. Just clone, build, and run.
For local development, the complete stack is deployed inside a local Kubernetes cluster, allowing developers to replicate a production-grade environment right on their machines.

We’ve made VendorIQ.ai fully open source under the MIT License, focusing on simplicity, extensibility, and community-driven improvement. The repository includes a comprehensive README, contribution guidelines, and architectural documentation so anyone can understand the system quickly and start contributing.

In short, VendorIQ.ai isn’t just a project—it’s a modular, scalable, and community-friendly platform built to bring enterprise-grade automation to SMBs, without the typical cost or complexity.
