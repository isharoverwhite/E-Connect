pipeline {
    agent any

    options {
        buildDiscarder(logRotator(numToKeepStr: '20', artifactNumToKeepStr: '10'))
        disableConcurrentBuilds()
        skipDefaultCheckout(true)
        timeout(time: 90, unit: 'MINUTES')
        timestamps()
    }

    environment {
        DOCKER_BUILDKIT = '1'
        BUILDKIT_PROGRESS = 'plain'
        DOCKER_REGISTRY = 'ryzen30xx'
        IMAGE_MQTT = 'econnect-mqtt'
        IMAGE_SERVER = 'econnect-server'
        IMAGE_WEBAPP = 'econnect-webapp'
    }

    stages {
        stage('Checkout') {
            steps {
                echo 'Checking out source from SCM...'
                checkout scm
            }
        }

        stage('Preflight') {
            steps {
                script {
                    env.RESOLVED_BRANCH = sh(
                        returnStdout: true,
                        script: '''
                            set -eu

                            for candidate in "${CHANGE_BRANCH:-}" "${BRANCH_NAME:-}" "${GIT_LOCAL_BRANCH:-}" "${GIT_BRANCH:-}"; do
                                if [ -n "$candidate" ]; then
                                    printf '%s' "$candidate" | sed -e 's#^origin/##' -e 's#^\\*/##'
                                    exit 0
                                fi
                            done

                            remote_branches="$(git for-each-ref --format='%(refname:short)' refs/remotes/origin --contains HEAD \\
                                | sed 's#^origin/##' \\
                                | grep -v '^HEAD$' || true)"

                            if [ -n "$remote_branches" ]; then
                                printf '%s\\n' "$remote_branches" | awk '/^(main|master)$/{ print; found=1; exit } END { if (!found && NR > 0) print $1 }'
                            else
                                printf 'detached'
                            fi
                        '''
                    ).trim()
                    echo "Resolved branch: ${env.RESOLVED_BRANCH}"
                }

                sh '''
                    set -eu
                    docker version
                    docker buildx version
                    docker system df || true

                    # Ensure buildx builder exists and is configured for multi-platform
                    docker buildx create --name econnect-builder --use || true
                    docker buildx inspect --bootstrap

                    buildx_activity_dir="${HOME:-/root}/.docker/buildx/activity"
                    mkdir -p "$buildx_activity_dir"
                    find "$buildx_activity_dir" -type f -delete || true
                '''
            }
        }

        stage('Build & Push CD') {
            when {
                expression { return ['main', 'master'].contains(env.RESOLVED_BRANCH) }
            }
            steps {
                echo 'Building and Pushing multi-platform images for E-Connect to Docker Hub.'
                sh '''
                    set -eu
                    
                    echo "Building and Pushing MQTT..."
                    docker buildx build \\
                        --platform linux/amd64,linux/arm64 \\
                        -t ${DOCKER_REGISTRY}/${IMAGE_MQTT}:latest \\
                        --push \\
                        ./mqtt

                    echo "Building and Pushing Server..."
                    docker buildx build \\
                        --platform linux/amd64,linux/arm64 \\
                        -t ${DOCKER_REGISTRY}/${IMAGE_SERVER}:latest \\
                        --push \\
                        ./server

                    echo "Building and Pushing WebApp..."
                    # Webapp requires NEXT_PUBLIC_API_URL and BACKEND_INTERNAL_URL build args
                    docker buildx build \\
                        --platform linux/amd64,linux/arm64 \\
                        --build-arg NEXT_PUBLIC_API_URL=/api/v1 \\
                        --build-arg BACKEND_INTERNAL_URL=http://server:8000 \\
                        -t ${DOCKER_REGISTRY}/${IMAGE_WEBAPP}:latest \\
                        --push \\
                        ./webapp
                '''
            }
        }
    }

    post {
        always {
            echo 'Cleaning up old images and build cache...'
            sh '''
                set -eu
                docker buildx prune -f || true
                docker image prune -a -f --filter "until=24h" || true
            '''
        }
        success {
            echo 'Pipeline finished successfully. Images pushed to Docker Hub.'
        }
        failure {
            echo 'Pipeline failed. Check build logs.'
        }
    }
}
