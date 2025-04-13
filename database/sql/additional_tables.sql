-- Additional tables for storing all extracted data

-- Table for storing individual images with categorization
CREATE TABLE IF NOT EXISTS `domain_images` (
  `id` int NOT NULL AUTO_INCREMENT,
  `domain_id` int NOT NULL,
  `url` varchar(512) COLLATE utf8mb4_unicode_ci NOT NULL,
  `page_url` varchar(512) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `filename` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `alt_text` text COLLATE utf8mb4_unicode_ci,
  `width` int DEFAULT NULL,
  `height` int DEFAULT NULL,
  `file_size` int DEFAULT NULL,
  `file_format` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `category` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT 'other',
  `score` int DEFAULT '0',
  `is_hero` tinyint(1) DEFAULT '0',
  `is_logo` tinyint(1) DEFAULT '0',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `domain_id` (`domain_id`),
  UNIQUE KEY `unique_domain_image` (`domain_id`, `url`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Table for storing podcast episodes
CREATE TABLE IF NOT EXISTS `domain_podcast_episodes` (
  `id` int NOT NULL AUTO_INCREMENT,
  `domain_id` int NOT NULL,
  `feed_id` int DEFAULT NULL,
  `title` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `description` text COLLATE utf8mb4_unicode_ci,
  `audio_url` varchar(512) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `page_url` varchar(512) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `image_url` varchar(512) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `published_date` datetime DEFAULT NULL,
  `duration` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `domain_id` (`domain_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Table for storing podcast feeds
CREATE TABLE IF NOT EXISTS `domain_podcast_feeds` (
  `id` int NOT NULL AUTO_INCREMENT,
  `domain_id` int NOT NULL,
  `feed_url` varchar(512) COLLATE utf8mb4_unicode_ci NOT NULL,
  `title` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `description` text COLLATE utf8mb4_unicode_ci,
  `image_url` varchar(512) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `author` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `link_url` varchar(512) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `feed_type` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT 'rss',
  `episode_count` int DEFAULT '0',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `domain_id` (`domain_id`),
  UNIQUE KEY `unique_domain_feed` (`domain_id`, `feed_url`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Table for storing RSS feeds
CREATE TABLE IF NOT EXISTS `domain_rss_feeds` (
  `id` int NOT NULL AUTO_INCREMENT,
  `domain_id` int NOT NULL,
  `feed_url` varchar(512) COLLATE utf8mb4_unicode_ci NOT NULL,
  `title` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `description` text COLLATE utf8mb4_unicode_ci,
  `feed_type` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT 'rss',
  `item_count` int DEFAULT '0',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `domain_id` (`domain_id`),
  UNIQUE KEY `unique_domain_rss` (`domain_id`, `feed_url`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Table for storing ISBN data
CREATE TABLE IF NOT EXISTS `domain_isbn_data` (
  `id` int NOT NULL AUTO_INCREMENT,
  `domain_id` int NOT NULL,
  `isbn` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `page_url` varchar(512) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `image_url` varchar(512) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `title` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `author` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `domain_id` (`domain_id`),
  UNIQUE KEY `unique_domain_isbn` (`domain_id`, `isbn`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Table for storing crawl progress
CREATE TABLE IF NOT EXISTS `domain_crawl_progress` (
  `id` int NOT NULL AUTO_INCREMENT,
  `domain_id` int NOT NULL,
  `job_id` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `pages_total` int DEFAULT '0',
  `pages_crawled` int DEFAULT '0',
  `current_url` varchar(512) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `status` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT 'pending',
  `last_active` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `domain_id` (`domain_id`),
  UNIQUE KEY `unique_domain_job` (`domain_id`, `job_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci; 