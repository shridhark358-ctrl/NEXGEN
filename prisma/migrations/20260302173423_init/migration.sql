-- CreateTable
CREATE TABLE "Pickup" (
    "pickup_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "caller_phone" TEXT NOT NULL,
    "raw_address_input" TEXT NOT NULL,
    "formatted_address" TEXT NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "place_id" TEXT NOT NULL,
    "scheduled_date" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL,
    "attempts_count" INTEGER NOT NULL,
    "source" TEXT NOT NULL,

    CONSTRAINT "Pickup_pkey" PRIMARY KEY ("pickup_id")
);
