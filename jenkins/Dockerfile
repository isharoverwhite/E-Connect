FROM jenkins/jenkins:lts

USER root

# Install prerequisites
RUN apt-get update && apt-get install -y lsb-release curl gnupg

# Add Docker’s official GPG key
RUN curl -fsSLo /usr/share/keyrings/docker-archive-keyring.asc https://download.docker.com/linux/debian/gpg

# Set up the stable repository
RUN echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/docker-archive-keyring.asc] https://download.docker.com/linux/debian $(lsb_release -cs) stable" > /etc/apt/sources.list.d/docker.list

# Install Docker CLI and Docker Compose Plugin
RUN apt-get update && apt-get install -y docker-ce-cli docker-compose-plugin

# Return to Jenkins user or stay as root for docker socket access
# Note: For simple setups mapping /var/run/docker.sock, running as root is easiest.
# Otherwise, we need to map the host docker group GID.
USER root
