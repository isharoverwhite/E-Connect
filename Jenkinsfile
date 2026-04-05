pipeline {
    agent any

    options {
        buildDiscarder(logRotator(numToKeepStr: '20', artifactNumToKeepStr: '10'))
        disableConcurrentBuilds()
        skipDefaultCheckout(true)
        timeout(time: 60, unit: 'MINUTES')
        timestamps()
    }

    parameters {
        booleanParam(
            name: 'DEPLOY',
            defaultValue: true,
            description: 'Deploy the public find_website container after validation.'
        )
        booleanParam(
            name: 'ALLOW_NON_MAIN_DEPLOY',
            defaultValue: false,
            description: 'Allow deployment from a branch other than main/master.'
        )
        string(
            name: 'PUBLIC_DISCOVERY_URL',
            defaultValue: '',
            description: 'Optional public find_website URL to smoke after deploy. Leave blank to skip.'
        )
    }

    environment {
        COMPOSE_FILE = 'docker-compose.jenkins.yml'
        COMPOSE_PROJECT_NAME = 'econnect'
        DOCKER_BUILDKIT = '1'
        BUILDKIT_PROGRESS = 'plain'
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

                            remote_branches="$(git for-each-ref --format='%(refname:short)' refs/remotes/origin --contains HEAD \
                                | sed 's#^origin/##' \
                                | grep -v '^HEAD$' || true)"

                            if [ -n "$remote_branches" ]; then
                                printf '%s\n' "$remote_branches" | awk '/^(main|master)$/{ print; found=1; exit } END { if (!found && NR > 0) print $1 }'
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
                    docker compose version
                    docker compose config -q
                    docker system df || true

                    buildx_activity_dir="${HOME:-/root}/.docker/buildx/activity"
                    mkdir -p "$buildx_activity_dir"
                    find "$buildx_activity_dir" -type f -delete || true
                '''
            }
        }

        stage('Build Gate') {
            steps {
                echo 'Building the public find_website image for Zotac.'
                sh '''
                    set -eu
                    docker compose build find_website
                '''
            }
        }

        stage('Deploy Gate') {
            when {
                expression { return params.DEPLOY }
            }
            steps {
                script {
                    if (!(params.ALLOW_NON_MAIN_DEPLOY || ['main', 'master'].contains(env.RESOLVED_BRANCH))) {
                        error("Refusing to deploy branch '${env.RESOLVED_BRANCH}'. Set ALLOW_NON_MAIN_DEPLOY=true to override.")
                    }
                }
            }
        }

        stage('Cleanup Legacy E-Connect Runtime') {
            when {
                expression { return params.DEPLOY }
            }
            steps {
                echo 'Removing legacy E-Connect runtime containers and images from Zotac before deploying only find_website.'
                sh '''
                    set -eu

                    docker compose down --remove-orphans || true

                    remove_container_if_present() {
                        name="$1"
                        if docker ps -a --format '{{.Names}}' | grep -Fxq "$name"; then
                            docker rm -f "$name" >/dev/null || true
                        fi
                    }

                    remove_repo_images() {
                        repo="$1"
                        image_ids="$(docker images --format '{{.Repository}} {{.ID}}' | awk -v repo="$repo" '$1 == repo { print $2 }' | sort -u)"
                        if [ -n "$image_ids" ]; then
                            printf '%s\n' "$image_ids" | xargs -r docker image rm -f >/dev/null || true
                        fi
                    }

                    for container in e-connect-db e-connect-mqtt e-connect-server e-connect-webapp; do
                        remove_container_if_present "$container"
                    done

                    project_container_ids="$(docker ps -aq --filter label=com.docker.compose.project=econnect || true)"
                    if [ -n "$project_container_ids" ]; then
                        printf '%s\n' "$project_container_ids" | xargs -r docker rm -f >/dev/null || true
                    fi

                    for repo in econnect-mqtt econnect-server econnect-webapp econnect-webapp-check econnect-server-test; do
                        remove_repo_images "$repo"
                    done

                    docker image prune -f --filter dangling=true || true
                    docker system df || true
                '''
            }
        }

        stage('Deploy') {
            when {
                expression { return params.DEPLOY }
            }
            steps {
                sh '''
                    set -eu
                    docker compose up -d --wait --wait-timeout 120 --remove-orphans
                '''
            }
        }

        stage('Smoke Test') {
            when {
                expression { return params.DEPLOY }
            }
            steps {
                sh '''
                    set -eu

                    retry() {
                        attempts="$1"
                        delay="$2"
                        shift 2

                        count=1
                        while [ "$count" -le "$attempts" ]; do
                            if "$@"; then
                                return 0
                            fi

                            if [ "$count" -eq "$attempts" ]; then
                                return 1
                            fi

                            count=$((count + 1))
                            sleep "$delay"
                        done
                    }

                    published_port="$(docker compose port find_website 9123 | awk -F: 'NF { print $NF }' | tail -n1)"
                    if [ -z "$published_port" ]; then
                        echo "Could not resolve the published port for find_website." >&2
                        exit 1
                    fi

                    host_probe_image="$(docker image inspect econnect-find-website --format '{{.Id}}' 2>/dev/null || true)"
                    if [ -z "$host_probe_image" ]; then
                        echo "Could not resolve the built image ID for find_website." >&2
                        exit 1
                    fi

                    retry 30 2 docker compose exec -T find_website wget -q --spider http://127.0.0.1:9123/

                    # Jenkins runs inside a container on Zotac, so probe the published port from the host network namespace.
                    docker_server_os="$(docker version --format '{{.Server.Os}}' 2>/dev/null || true)"
                    if [ "$docker_server_os" = "linux" ]; then
                        retry 30 2 sh -c "docker run --rm --network host --entrypoint wget \"$host_probe_image\" -q --spider \"http://127.0.0.1:${published_port}/\""
                    else
                        echo "Skipping published-port smoke: Docker server OS '${docker_server_os:-unknown}' does not support the host-network probe."
                    fi

                    public_discovery_url="${PUBLIC_DISCOVERY_URL:-}"
                    if [ -n "$public_discovery_url" ]; then
                        retry 10 3 sh -c "curl -fsSI \"$public_discovery_url\" >/dev/null"
                    else
                        echo "Skipping public URL smoke: PUBLIC_DISCOVERY_URL is not configured."
                    fi
                '''
            }
        }
    }

    post {
        always {
            sh '''
                docker compose ps || true
            '''
        }

        failure {
            sh '''
                docker compose logs --tail=200 find_website || true
            '''
            echo 'Deployment failed. Review the public finder logs above.'
        }

        success {
            echo 'Pipeline finished successfully.'
        }
    }
}
