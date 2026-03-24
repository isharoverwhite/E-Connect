pipeline {
    agent any

    environment {
        // Có thể định nghĩa thêm các environment variable nếu cần
        DOCKER_BUILDKIT = 1
    }

    stages {
        stage('Checkout') {
            steps {
                echo "1. Checking out latest code from SCM..."
                checkout scm
            }
        }
        
        stage('Deploy with Docker Compose') {
            steps {
                echo "2. Rebuilding and deploying application..."
                sh '''
                # Tắt các container hiện tại
                docker compose down
                
                # Khởi động lại các container với source code mới cài đặt (--build)
                docker compose up -d --build
                '''
            }
        }
    }
    
    post {
        success {
            echo "🚀 Deployment successful!"
        }
        failure {
            echo "❌ Deployment failed! Please check logs."
        }
    }
}
